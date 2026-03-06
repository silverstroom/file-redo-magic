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
  // Extract day info
  const dateMatch = eventName.match(/(\d{1,2})\s*(?:ago|agosto|lug|luglio|giu|giugno)/i);
  if (dateMatch) return `${dateMatch[1]} Ago`;
  const dayMatch = eventName.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (dayMatch) return `${dayMatch[1]}-${dayMatch[2]} Ago`;
  return eventName.replace(/color\s*fest\s*\d+\s*/i, '').trim() || '1 Day';
}

export function WeeklySalesCard({ events }: WeeklySalesCardProps) {
  const [breakdown, setBreakdown] = useState<WeeklyBreakdownItem[]>([]);
  const [totals, setTotals] = useState<{ biglietti: number; presenze: number; eventsCount: number } | null>(null);

  const today = new Date();
  const weekAgo = subDays(today, 7);
  const dateLabel = `${format(weekAgo, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`;

  const computeWeekly = useCallback(async () => {
    try {
      const weekAgoStr = subDays(today, 7).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

      const { data: baselineSnapshots } = await supabase
        .from('ticket_snapshots')
        .select('event_id, event_name, tickets_sold')
        .lte('snapshot_date', weekAgoStr)
        .order('snapshot_date', { ascending: false })
        .limit(100);

      if (!baselineSnapshots || baselineSnapshots.length === 0) {
        setTotals(null);
        setBreakdown([]);
        return;
      }

      const baselineMap = new Map<string, { tickets_sold: number; event_name: string }>();
      for (const s of baselineSnapshots) {
        if (s.event_id && !baselineMap.has(s.event_id) && isColorFestEvent(s.event_name || '')) {
          baselineMap.set(s.event_id, { tickets_sold: s.tickets_sold, event_name: s.event_name || '' });
        }
      }

      const cfEvents = events.filter(e => isColorFestEvent(e.name));
      let totalBiglietti = 0;
      let totalPresenze = 0;

      // Group by category
      const categoryMap = new Map<string, { ticketsDelta: number; presenzeDelta: number }>();

      for (const event of cfEvents) {
        const baseline = baselineMap.get(event.id);
        const baselineSold = baseline?.tickets_sold ?? 0;
        const delta = Math.max(0, event.ticketsSold - baselineSold);
        const presenze = delta * getPresenzeMultiplier(event.name);
        totalBiglietti += delta;
        totalPresenze += presenze;

        const category = getTicketCategory(event.name);
        const existing = categoryMap.get(category) || { ticketsDelta: 0, presenzeDelta: 0 };
        categoryMap.set(category, {
          ticketsDelta: existing.ticketsDelta + delta,
          presenzeDelta: existing.presenzeDelta + presenze,
        });
      }

      const items: WeeklyBreakdownItem[] = Array.from(categoryMap.entries())
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
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Una settimana fa</p>
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
