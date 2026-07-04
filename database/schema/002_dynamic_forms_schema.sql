CREATE TABLE IF NOT EXISTS form_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  placeholder TEXT,
  help_text TEXT,
  options TEXT,
  is_required INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  page_id INTEGER,
  form_id INTEGER,
  lead_id INTEGER,
  submission_type TEXT DEFAULT 'lead',
  status TEXT DEFAULT 'received',
  raw_payload TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (page_id) REFERENCES pages(id),
  FOREIGN KEY (form_id) REFERENCES forms(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  page_id INTEGER,
  form_id INTEGER,
  lead_id INTEGER,
  submission_id INTEGER,
  asset_type TEXT,
  file_name TEXT,
  file_url TEXT,
  mime_type TEXT,
  file_size INTEGER,
  storage_provider TEXT DEFAULT 'cloudflare_r2',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (page_id) REFERENCES pages(id),
  FOREIGN KEY (form_id) REFERENCES forms(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);