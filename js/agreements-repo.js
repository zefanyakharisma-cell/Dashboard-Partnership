/* =========================================================================
   Supabase data repository for institutions, departments, and agreements.

   The dashboard keeps its UI state in `Store.state` (camelCase). This file:
     - loads the three tables on boot and returns them in the camelCase shape
     - exposes insert/update/remove for agreements
     - subscribes to realtime events on `agreements` and re-renders the
       current route whenever a row arrives, changes, or is deleted

   It does NOT manage activityLogs, notifications, statusHistory, or files —
   those remain client-only in localStorage for now. Only the `agreements`,
   `institutions`, and `departments` tables are mirrored to Postgres.
   ========================================================================= */
'use strict';

(function () {
  const sb = () => window.supabaseClient;

  // --- camelCase <-> row mappers ------------------------------------------

  const toIsoDate = (d) => (d ? new Date(d).toISOString() : null);

  // Derive "Expired" from end_date at read time. We do not store "Expired"
  // in the lifecycle column anymore — the dashboard flips a row as soon as
  // its end_date passes, no SQL cron needed.
  function deriveStatus(stored, endDate) {
    if (!endDate) return stored;
    const isActive = stored === 'Active' || stored === 'Auto-renewed';
    if (!isActive) return stored;
    const end = new Date(endDate);
    if (isNaN(end)) return stored;
    return end.getTime() < Date.now() ? 'Expired' : stored;
  }

  function rowToInstitution(i) {
    return {
      id: i.id,
      name: i.name,
      country: i.country || i.city || '—',
      type: i.type || 'University',
      institutionTypes: i.institution_types || [],
      kind: i.kind,
      city: i.city,
      address: i.address,
      canonicalName: i.canonical_name,
    };
  }

  function rowToDepartment(d) {
    return {
      id: d.id,
      name: d.name || d.short,
      short: d.short,
      isFaculty: !!d.is_faculty,
    };
  }

  function rowToAgreement(r) {
    const startIso = toIsoDate(r.start_date) || new Date().toISOString();
    const endIso = toIsoDate(r.end_date);
    const status = deriveStatus(r.status, endIso);
    const isLive = ['Active', 'Auto-renewed', 'Open-ended', 'Ended', 'Expired'].includes(status);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      type: r.type === 'Unknown' ? 'MoU' : (r.type || 'MoU'),
      institutionId: r.institution_id,
      departmentId: r.department_id,
      picUserId: r.pic_user_id,
      status,
      // `storedStatus` keeps the raw lifecycle value (without the Expired
      // derivation) so the edit form round-trips correctly.
      storedStatus: r.status,
      progress: typeof window.stageProgress === 'function' ? window.stageProgress(status) : 0,
      startDate: startIso,
      endDate: endIso,
      signedDate: isLive ? startIso : null,
      createdAt: r.created_at || startIso,
      updatedAt: r.updated_at || startIso,
      description: r.description || '',
      notes: r.notes || '',
      tags: r.tags || [],
      files: [],
      statusHistory: [],
      sourceNo: r.source_no,
      kind: r.kind,
      scope: r.scope,
      scopeTags: r.scope_tags || [],
      implementingUnit: r.implementing_unit,
      units: r.units || [],
      unitDepartmentIds: r.unit_department_ids || [],
      institutionType: r.institution_type || [],
      newPartner: !!r.new_partner,
      endDateKind: r.end_date_kind,
      endDateRaw: r.end_date_raw,
      renewalDate: r.renewal_date,
      renewalInfoRaw: r.renewal_info_raw,
      realization: r.realization,
      degreeProgram: r.degree_program,
      nonDegreeProgram: r.non_degree_program,
    };
  }

  // Convert the camelCase form the UI produces back into Postgres column
  // names. Used for insert/update.
  function agreementToRow(a) {
    const toDateOnly = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    };
    // Never persist the derived "Expired" status — keep the underlying
    // lifecycle value so the server stays the source of truth.
    let storedStatus = a.storedStatus || a.status || 'Drafting';
    if (storedStatus === 'Expired') storedStatus = 'Active';
    return {
      id: a.id,
      code: a.code ?? null,
      source_no: a.sourceNo ?? null,
      kind: a.kind ?? null,
      title: a.title,
      type: a.type || 'MoU',
      status: storedStatus,
      institution_id: a.institutionId ?? null,
      department_id: a.departmentId ?? null,
      pic_user_id: a.picUserId && /^[0-9a-f-]{36}$/i.test(a.picUserId) ? a.picUserId : null,
      implementing_unit: a.implementingUnit ?? null,
      units: Array.isArray(a.units) ? a.units : [],
      unit_department_ids: Array.isArray(a.unitDepartmentIds) ? a.unitDepartmentIds : [],
      scope: a.scope ?? null,
      scope_tags: Array.isArray(a.scopeTags) ? a.scopeTags : [],
      institution_type: Array.isArray(a.institutionType) ? a.institutionType : [],
      start_date: toDateOnly(a.startDate),
      end_date: toDateOnly(a.endDate),
      end_date_kind: a.endDateKind ?? null,
      end_date_raw: a.endDateRaw ?? null,
      renewal_date: toDateOnly(a.renewalDate),
      renewal_info_raw: a.renewalInfoRaw ?? null,
      realization: a.realization ?? null,
      degree_program: a.degreeProgram ?? null,
      non_degree_program: a.nonDegreeProgram ?? null,
      description: a.description ?? null,
      notes: a.notes ?? null,
      tags: Array.isArray(a.tags) ? a.tags : [],
      new_partner: !!a.newPartner,
    };
  }

  // --- CRUD ---------------------------------------------------------------

  async function loadAll() {
    const client = sb();
    if (!client) throw new Error('Supabase client is not initialized.');
    const [iRes, dRes, aRes] = await Promise.all([
      client.from('institutions').select('*'),
      client.from('departments').select('*'),
      client.from('agreements').select('*'),
    ]);
    for (const r of [iRes, dRes, aRes]) {
      if (r.error) throw r.error;
    }
    return {
      institutions: (iRes.data || []).map(rowToInstitution),
      departments:  (dRes.data || []).map(rowToDepartment),
      agreements:   (aRes.data || []).map(rowToAgreement),
    };
  }

  async function insertAgreement(agreement) {
    const client = sb();
    if (!client) throw new Error('Supabase client is not initialized.');
    const { data, error } = await client
      .from('agreements')
      .insert(agreementToRow(agreement))
      .select()
      .single();
    if (error) throw error;
    return rowToAgreement(data);
  }

  async function updateAgreement(id, patchOrAgreement) {
    const client = sb();
    if (!client) throw new Error('Supabase client is not initialized.');
    const row = agreementToRow({ ...patchOrAgreement, id });
    // Don't send id through the patch — it's already the filter.
    delete row.id;
    const { data, error } = await client
      .from('agreements')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return rowToAgreement(data);
  }

  async function deleteAgreement(id) {
    const client = sb();
    if (!client) throw new Error('Supabase client is not initialized.');
    const { error } = await client.from('agreements').delete().eq('id', id);
    if (error) throw error;
  }

  // --- Realtime -----------------------------------------------------------

  let _channel = null;

  function subscribe({ onChange } = {}) {
    const client = sb();
    if (!client) return null;
    if (_channel) {
      try { client.removeChannel(_channel); } catch (e) { /* ignore */ }
      _channel = null;
    }
    _channel = client
      .channel('agreements-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agreements' },
        (payload) => {
          const evt = payload.eventType;
          if (evt === 'INSERT' || evt === 'UPDATE') {
            onChange?.({ type: evt, agreement: rowToAgreement(payload.new) });
          } else if (evt === 'DELETE') {
            onChange?.({ type: evt, agreement: { id: payload.old.id } });
          }
        },
      )
      .subscribe();
    return _channel;
  }

  function unsubscribe() {
    const client = sb();
    if (client && _channel) {
      try { client.removeChannel(_channel); } catch (e) { /* ignore */ }
    }
    _channel = null;
  }

  window.AgreementsRepo = {
    loadAll,
    insertAgreement,
    updateAgreement,
    deleteAgreement,
    subscribe,
    unsubscribe,
    rowToAgreement,
    agreementToRow,
    deriveStatus,
  };
})();
