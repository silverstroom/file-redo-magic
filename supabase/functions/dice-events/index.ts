import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DICE_GRAPHQL_URL = 'https://partners-endpoint.dice.fm/graphql';
const DICE_REQUEST_TIMEOUT_MS = 15000;

async function executeDiceQuery(query: string, apiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), DICE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DICE_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAllViewerEvents(apiKey: string) {
  const allEdges: any[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;
  let totalCount = 0;

  while (hasNextPage) {
    const afterClause = afterCursor ? `, after: "${afterCursor}"` : '';
    const query = `{
      viewer {
        events(first: 50${afterClause}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id name state startDatetime endDatetime totalTicketAllocationQty
              ticketTypes { id name price totalTicketAllocationQty }
              tickets(first: 0) { totalCount }
            }
          }
        }
      }
    }`;

    const { response, data } = await executeDiceQuery(query, apiKey);
    if (!response.ok) throw new Error(`DICE API error: ${response.status}`);

    const eventsNode = data?.data?.viewer?.events;
    const edges = eventsNode?.edges || [];
    totalCount = eventsNode?.totalCount || totalCount;
    allEdges.push(...edges);
    hasNextPage = Boolean(eventsNode?.pageInfo?.hasNextPage);
    afterCursor = eventsNode?.pageInfo?.endCursor || null;
    if (!afterCursor || (totalCount > 0 && allEdges.length >= totalCount)) hasNextPage = false;
  }

  return { data: { viewer: { events: { totalCount, edges: allEdges } } } };
}

async function introspectDiceSchema(apiKey: string) {
  const query = `{
    operatorsDateInput: __type(name: "OperatorsDateInput") {
      name
      inputFields { name type { name kind ofType { name kind } } }
    }
  }`;
  const { data } = await executeDiceQuery(query, apiKey);
  return data;
}

async function fetchTodayTicketCounts(apiKey: string, todayISO: string): Promise<Record<string, number> | null> {
  try {
    // Calculate the UTC equivalent of midnight Italian time (CET=UTC+1, CEST=UTC+2)
    // Create a date at midnight in Europe/Rome, then get its UTC representation
    const midnightLocal = new Date(`${todayISO}T00:00:00`);
    // Get the timezone offset for Rome (we approximate: March = CET = UTC+1)
    // More robust: use the actual offset
    const romeDate = new Date(midnightLocal.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    const utcDate = new Date(midnightLocal.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMs = utcDate.getTime() - romeDate.getTime();
    const todayStartUTC = new Date(midnightLocal.getTime() + offsetMs).toISOString();
    
    console.log(`Today filter: todayISO=${todayISO}, todayStartUTC=${todayStartUTC}`);
    
    const query = `{
      viewer {
        orders(first: 50, where: { purchasedAt: { gte: "${todayStartUTC}" } }) {
          totalCount
          edges {
            node {
              id
              purchasedAt
              event { id name }
              quantity
            }
          }
        }
      }
    }`;

    const { response, data } = await executeDiceQuery(query, apiKey);
    if (!response.ok) {
      console.error('Orders query failed:', response.status);
      return null;
    }

    const ordersNode = data?.data?.viewer?.orders;
    if (!ordersNode) {
      console.error('Orders query error:', JSON.stringify(data?.errors || data));
      return null;
    }

    console.log(`Today orders: totalCount=${ordersNode.totalCount}, edges=${JSON.stringify(ordersNode.edges?.slice(0, 5))}`);

    const counts: Record<string, number> = {};
    for (const edge of (ordersNode.edges || [])) {
      const eventId = edge.node?.event?.id;
      const qty = edge.node?.quantity || 1;
      if (eventId) {
        counts[eventId] = (counts[eventId] || 0) + qty;
      }
    }
    return counts;
  } catch (err) {
    console.error('fetchTodayTicketCounts error:', err);
    return null;
  }
}

function getTodayISO(): string {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('DICE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'DICE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let body: Record<string, any> = {};
    try { const raw = await req.text(); body = raw ? JSON.parse(raw) : {}; } catch {}

    const action = typeof body.action === 'string' ? body.action : 'fetch_events';

    if (action === 'fetch_events') {
      let data: any;
      try { data = await fetchAllViewerEvents(apiKey); } catch (apiError) {
        return new Response(JSON.stringify({ success: false, error: apiError instanceof Error ? apiError.message : 'DICE API error' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let todayBaseline: any[] | null = null;
      let todayTicketCounts: Record<string, number> | null = null;
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const today = getTodayISO();
        const edges = data?.data?.viewer?.events?.edges || [];
        const activeEdges = edges.filter((edge: any) => edge.node.state !== 'CANCELLED');
        const rows = activeEdges.map((edge: any) => ({
          event_id: edge.node.id, event_name: edge.node.name, ticket_type: 'total',
          tickets_sold: edge.node.tickets?.totalCount || 0, snapshot_date: today,
        }));

        if (rows.length > 0) {
          await sb.from('ticket_snapshots').upsert(rows, { onConflict: 'event_id,snapshot_date', ignoreDuplicates: true }).throwOnError();
        }

        const { data: baselineData } = await sb.from('ticket_snapshots').select('event_id, event_name, tickets_sold').eq('snapshot_date', today);
        todayBaseline = baselineData;

        const { data: prevDates } = await sb.from('ticket_snapshots').select('snapshot_date').lt('snapshot_date', today).order('snapshot_date', { ascending: false }).limit(1);
        let yesterdayBaseline = null;
        if (prevDates && prevDates.length > 0) {
          const { data: ydData } = await sb.from('ticket_snapshots').select('event_id, event_name, tickets_sold').eq('snapshot_date', prevDates[0].snapshot_date);
          yesterdayBaseline = ydData;
        }

        // Try to get today's orders from DICE API
        const todayCounts = await fetchTodayTicketCounts(apiKey, today);
        if (todayCounts && Object.keys(todayCounts).length > 0) {
          todayTicketCounts = todayCounts;
        }

        // Also run schema introspection for debugging
        try {
          const schemaInfo = await introspectDiceSchema(apiKey);
          console.log('DICE schema introspection:', JSON.stringify(schemaInfo).substring(0, 2000));
        } catch (e) { console.error('Introspection failed:', e); }

        return new Response(JSON.stringify({ success: true, data, todayBaseline, yesterdayBaseline, todayTicketCounts }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (snapErr) {
        console.error('Snapshot error:', snapErr);
        return new Response(JSON.stringify({ success: true, data, todayBaseline: null, yesterdayBaseline: null, todayTicketCounts: null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (action === 'fetch_event_tickets') {
      const eventId = body.eventId;
      if (!eventId) return new Response(JSON.stringify({ success: false, error: 'Missing eventId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const query = `{ node(id: "${eventId}") { ... on Event { id name ticketTypes { id name price totalTicketAllocationQty } tickets(first: 0) { totalCount } } } }`;
      const { data } = await executeDiceQuery(query, apiKey);
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
