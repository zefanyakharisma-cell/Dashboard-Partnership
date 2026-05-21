#!/usr/bin/env node
/* =========================================================================
   One-time importer: reads data/institutions.json, data/departments.json,
   and data/agreements.json from the project root and upserts them into
   Supabase.

   Usage:
     SUPABASE_URL="https://xxxx.supabase.co" \
     SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
     node scripts/import_to_supabase.mjs

   The service-role key bypasses RLS and is required because we're writing
   rows on behalf of nobody. NEVER ship this key to the browser — keep it
   in your shell history / a local .env that is gitignored.
   ========================================================================= */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(ROOT, 'data');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const readJson = async (name) =>
  JSON.parse(await readFile(resolve(DATA, name), 'utf8'));

// Insert in chunks so we don't blow past Postgres' parameter limits.
async function upsertChunked(table, rows, conflict = 'id', chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase
      .from(table)
      .upsert(slice, { onConflict: conflict });
    if (error) {
      console.error(`Failed to upsert ${table} (chunk ${i}-${i + slice.length}):`, error);
      process.exit(1);
    }
    console.log(`  ${table}: ${i + slice.length}/${rows.length}`);
  }
}

// Map a JSON record to the table column shape. Date strings come through
// untouched — Postgres accepts ISO-8601 for `date` columns. JSONB fields
// pass through as objects.
function mapInstitution(i) {
  return {
    id: i.id,
    name: i.name,
    canonical_name: i.canonical_name ?? null,
    type: i.type ?? null,
    kind: i.kind ?? null,
    country: i.country ?? null,
    city: i.city ?? null,
    address: i.address ?? null,
    institution_types: Array.isArray(i.institution_types) ? i.institution_types : [],
  };
}

function mapDepartment(d) {
  return {
    id: d.id,
    short: d.short,
    name: d.name || d.short,
    is_faculty: !!d.is_faculty,
  };
}

function mapAgreement(a) {
  // Some legacy rows have non-date end_date_raw (e.g. "TBD"). Keep raw text
  // separately; only push parseable ISO dates to the typed columns.
  const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  };
  return {
    id: a.id,
    code: a.code ?? null,
    source_no: a.source_no ?? null,
    kind: a.kind ?? null,
    title: a.title,
    type: a.type === 'Unknown' || !a.type ? 'MoU' : a.type,
    status: a.status || 'Drafting',
    institution_id: a.institution_id ?? null,
    department_id: a.department_id ?? null,
    pic_user_id: null,
    implementing_unit: a.implementing_unit ?? null,
    units: Array.isArray(a.units) ? a.units : [],
    unit_department_ids: Array.isArray(a.unit_department_ids) ? a.unit_department_ids : [],
    scope: a.scope ?? null,
    scope_tags: Array.isArray(a.scope_tags) ? a.scope_tags : [],
    institution_type: Array.isArray(a.institution_type) ? a.institution_type : [],
    start_date: toDate(a.start_date),
    end_date: toDate(a.end_date),
    end_date_kind: a.end_date_kind ?? null,
    end_date_raw: a.end_date_raw ?? null,
    renewal_date: toDate(a.renewal_date),
    renewal_info_raw: a.renewal_info_raw ?? null,
    realization: a.realization ?? null,
    degree_program: a.degree_program ?? null,
    non_degree_program: a.non_degree_program ?? null,
    description: a.agenda ?? a.description ?? null,
    notes: a.note ?? a.notes ?? null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    new_partner: !!a.new_partner,
  };
}

async function main() {
  console.log('Reading data/*.json …');
  const [insts, depts, ags] = await Promise.all([
    readJson('institutions.json'),
    readJson('departments.json'),
    readJson('agreements.json'),
  ]);
  console.log(`  ${insts.length} institutions, ${depts.length} departments, ${ags.length} agreements`);

  console.log('Upserting institutions …');
  await upsertChunked('institutions', insts.map(mapInstitution));

  console.log('Upserting departments …');
  await upsertChunked('departments', depts.map(mapDepartment));

  console.log('Upserting agreements …');
  await upsertChunked('agreements', ags.map(mapAgreement));

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
