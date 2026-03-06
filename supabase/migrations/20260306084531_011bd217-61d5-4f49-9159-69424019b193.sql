-- Create ticket_snapshots table
CREATE TABLE public.ticket_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT,
  event_name TEXT,
  ticket_type TEXT NOT NULL DEFAULT 'total',
  tickets_sold INTEGER NOT NULL DEFAULT 0,
  snapshot_date TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD'),
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, snapshot_date)
);

ALTER TABLE public.ticket_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to ticket_snapshots"
  ON public.ticket_snapshots FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow service role full access to ticket_snapshots"
  ON public.ticket_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Create historical_daily_presenze table
CREATE TABLE public.historical_daily_presenze (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  edition_key TEXT NOT NULL,
  sale_date TEXT NOT NULL,
  presenze_delta INTEGER NOT NULL DEFAULT 0,
  tickets_delta INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(edition_key, sale_date)
);

ALTER TABLE public.historical_daily_presenze ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to historical_daily_presenze"
  ON public.historical_daily_presenze FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow service role full access to historical_daily_presenze"
  ON public.historical_daily_presenze FOR ALL TO service_role USING (true) WITH CHECK (true);