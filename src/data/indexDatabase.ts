import {mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";

export const DEFAULT_INDEX_PATH=resolve(process.env.GRANTPILOT_DATA_DB??"data/index/grantpilot.sqlite");

export function openIndexDatabase(options:{path?:string;readOnly?:boolean}={}){
 const path=resolve(options.path??DEFAULT_INDEX_PATH);
 if(!options.readOnly)mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path,{readOnly:options.readOnly,timeout:5_000});
 if(!options.readOnly){
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
  initializeIndexSchema(db);
 }
 return db;
}

export function initializeIndexSchema(db:DatabaseSync){
 db.exec(`
 CREATE TABLE IF NOT EXISTS source_ingestions (
   source_key TEXT PRIMARY KEY,
   source_path TEXT NOT NULL,
   fingerprint TEXT NOT NULL,
   source_size INTEGER NOT NULL,
   source_mtime_ms INTEGER NOT NULL,
   status TEXT NOT NULL,
   record_count INTEGER NOT NULL DEFAULT 0,
   started_at TEXT NOT NULL,
   completed_at TEXT,
   message TEXT
 );
 CREATE TABLE IF NOT EXISTS federal_opportunities (
   opportunity_number TEXT PRIMARY KEY,
   opportunity_id TEXT,
   title TEXT NOT NULL,
   agency_name TEXT NOT NULL,
   agency_code TEXT,
   summary TEXT NOT NULL,
   description TEXT,
   mission_topics_json TEXT NOT NULL,
   eligible_applicants_json TEXT NOT NULL,
   assistance_listing_numbers_json TEXT NOT NULL,
   award_min REAL,
   award_max REAL,
   expected_award_count INTEGER,
   requires_cost_share INTEGER,
   posted_date TEXT,
   close_date TEXT,
   archive_date TEXT,
   last_updated TEXT,
   status TEXT NOT NULL,
   source_url TEXT NOT NULL,
   application_url TEXT,
   requirements_json TEXT NOT NULL,
   raw_source_reference TEXT,
   verified_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS federal_opportunities_status_idx ON federal_opportunities(status);
 CREATE INDEX IF NOT EXISTS federal_opportunities_close_date_idx ON federal_opportunities(close_date);
 CREATE INDEX IF NOT EXISTS federal_opportunities_agency_idx ON federal_opportunities(agency_code);
 CREATE VIRTUAL TABLE IF NOT EXISTS federal_opportunities_fts USING fts5(
   opportunity_number,
   title,
   agency_name,
   summary,
   mission_topics,
   eligible_applicants
 );
 CREATE TABLE IF NOT EXISTS federal_award_statistics (
   assistance_listing_number TEXT PRIMARY KEY,
   award_count INTEGER NOT NULL,
   median_award REAL,
   washington_awards INTEGER,
   period_start TEXT NOT NULL,
   period_end TEXT NOT NULL,
   refreshed_at TEXT NOT NULL,
   source_url TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS irs_filing_index (
   object_id TEXT PRIMARY KEY,
   ein TEXT,
   tax_period TEXT,
   return_type TEXT NOT NULL,
   organization_name TEXT,
   xml_batch_id TEXT NOT NULL,
   indexed_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS irs_filing_index_ein_idx ON irs_filing_index(ein);
 CREATE INDEX IF NOT EXISTS irs_filing_index_batch_idx ON irs_filing_index(xml_batch_id);
 CREATE TABLE IF NOT EXISTS private_funder_prospects (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   object_id TEXT NOT NULL,
   ein TEXT,
   foundation_name TEXT NOT NULL,
   tax_period TEXT,
   recipient_name TEXT,
   recipient_state TEXT,
   amount REAL,
   purpose TEXT,
   mission_topics_json TEXT NOT NULL,
   source_url TEXT NOT NULL,
   source_xml_path TEXT,
   indexed_at TEXT NOT NULL,
   UNIQUE(object_id,recipient_name,amount,purpose)
 );
 CREATE INDEX IF NOT EXISTS private_funder_prospects_ein_idx ON private_funder_prospects(ein);
 CREATE INDEX IF NOT EXISTS private_funder_prospects_object_idx ON private_funder_prospects(object_id);
 CREATE VIRTUAL TABLE IF NOT EXISTS private_funder_prospects_fts USING fts5(
   foundation_name,
   recipient_name,
   purpose,
   mission_topics
 );
 `);
}
