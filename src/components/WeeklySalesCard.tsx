import { useEffect, useState, useCallback } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import type { DiceEventRaw } from '@/lib/ticket-utils';

interface WeeklySalesCardProps {
  events: DiceEventRaw[];
}

interface WeeklyBreakdownItem {
  label: string;
  ticketsDelta: number;
  presenzeDelta: number;
}

function isColorFestEvent(eventName: string): boolean {
  return /color\s*fest\s*\d/i.test(eventName);
}

function getPresenzeMultiplier(eventName: string): number {
  if (/2\s*days?/i.test(eventName)) return 2;
  if (/(abbonamento|full)/i.test(eventName) && !/1\s*day|one\s*day/i.test(eventName)) return 3;
  return 1;
}

function getTicketCategory(eventName: string): string {
  if (/(abbonamento|full)/i.test(eventName) && !/1\s*day|one\s*day/i.test(eventName)) return 'Abbonamento';
  if (/2\s*days?/i.test(eventName)) return '2 Days';
  const dateMatch = eventName.match(/(\d{1,2})\s*(?:ago|agosto|lug|luglio|giu|giugno)/i);
  if (dateMatch) return `${dateMatch[1]} Ago`;
  const dayMatch = eventName.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (dayMatch) return `${dayMatch[1]}-${dayMatch[2]} Ago`;
  return eventName.replace(/color\s*fest\s*\d+\s*/i, '').trim() || '1 Day';
}

export function WeeklySalesCard({ events }: WeeklySalesCardProps) {
  const [breakdown, setBreakdown] = useState<WeeklyBreakdownItem[]>([]);
  const [totals, setTotals] = useState<{ biglietti: number; presenze: number; eventsCount: number } | null>(null);
  const [dateLabel, setDateLabel] = useState('');

  const computeWeekly = useCallback(async () => {
    try {
      const cfEvents = events.filter(e => isColorFestEvent(e.name));
      if (cfEvents.length === 0) return;

      const today = new Date();
      const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
      const weekAgo = subDays(today, 7);
      const weekAgoStr = weekAgo.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

      setDateLabel(`${format(weekAgo, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`);

      // Try to find a baseline snapshot around 7 days ago, fallback to oldest available
      let baselineSnapshots: any[] | null = null;

      // First try: snapshots <= 7 days ago
      const { data: weekAgoSnaps } = await supabase
        .from('ticket_snapshots')
        .select('event_id, event_name, tickets_sold, snapshot_date')
        .lte('snapshot_date', weekAgoStr)
        .order('snapshot_date', { ascending: false })
        .limit(100);

      if (weekAgoSnaps && weekAgoSnaps.length > 0) {
        baselineSnapshots = weekAgoSnaps;
      } else {
        // Fallback: use the oldest snapshots we have
        const { data: oldestSnaps } = await supabase
          .from('ticket_snapshots')
          .select('event_id, event_name, tickets_sold, snapshot_date')
          .order('snapshot_date', { ascending: true })
          .limit(100);

        if (oldestSnaps && oldestSnaps.length > 0) {
          baselineSnapshots = oldestSnaps;
          // Update date label to reflect actual baseline date
          const baseDate = new Date(oldestSnaps[0].snapshot_date);
          setDateLabel(`${format(baseDate, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`);
        }
      }

      // Build baseline map (use first occurrence per event from sorted results)
      const baselineMap = new Map<string, number>();
      if (baselineSnapshots) {
        const seen = new Set<string>();
        for (const s of baselineSnapshots) {
          if (s.event_id && !seen.has(s.event_id) && isColorFestEvent(s.event_name || '')) {
            seen.add(s.event_id);
            baselineMap.set(s.event_id, s.tickets_sold);
          }
        }
      }

      let totalBiglietti = 0;
      let totalPresenze = 0;
      const categoryMap = new Map<string, { ticketsDelta: number; presenzeDelta: number }>();

      for (const event of cfEvents) {
        const baselineSold = baselineMap.get(event.id) ?? 0;
        const delta = Math.max(0, event.ticketsSold - baselineSold);
        // If no baseline exists, show current total
        const effectiveDelta = baselineMap.size === 0 ? event.ticketsSold : delta;
        const presenze = effectiveDelta * getPresenzeMultiplier(event.name);

        totalBiglietti += effectiveDelta;
        totalPresenze += presenze;

        const category = getTicketCategory(event.name);
        const existing = categoryMap.get(category) || { ticketsDelta: 0, presenzeDelta: 0 };
        categoryMap.set(category, {
          ticketsDelta: existing.ticketsDelta + effectiveDelta,
          presenzeDelta: existing.presenzeDelta + presenze,
        });
      }

      const items = Array.from(categoryMap.entries())
        .map(([label, data]) => ({ label, ...data }))
        .sort((a, b) => b.ticketsDelta - a.ticketsDelta);

      setBreakdown(items);
      setTotals({ biglietti: totalBiglietti, presenze: totalPresenze, eventsCount: cfEvents.length });
    } catch (err) {
      console.error('Error computing weekly sales:', err);
    }
  }, [events]);

  useEffect(() => {
    if (events.length > 0) computeWeekly();
  }, [events, computeWeekly]);

  if (!totals) return null;

  return (
    <div className="soft-card-purple p-5 transition-all duration-300 hover:scale-[1.02] hover:shadow-md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Riepilogo vendite</p>
          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <div className="p-2.5 rounded-2xl bg-foreground/5">
          <CalendarDays className="w-5 h-5 text-muted-foreground" />
        </div>
      </div>

      <div className="space-y-2.5 mb-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Eventi in vendita</span>
          <span className="text-sm font-bold font-mono">{totals.eventsCount}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Biglietti venduti</span>
          <span className="text-sm font-bold font-mono">{totals.biglietti.toLocaleString('it-IT')}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Presenze</span>
          <span className="text-sm font-bold font-mono">{totals.presenze.toLocaleString('it-IT')}</span>
        </div>
      </div>

      {breakdown.length > 0 && (
        <div className="pt-3 border-t border-foreground/8 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Dettaglio per tipo</p>
          {breakdown.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-mono font-semibold text-foreground">
                {item.ticketsDelta} big. → {item.presenzeDelta} pres.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
