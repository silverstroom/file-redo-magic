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

function isCF14Event(eventName: string): boolean {
  return /color\s*fest\s*14/i.test(eventName);
}

function getPresenzeMultiplier(eventName: string): number {
  if (/2\s*days?/i.test(eventName)) return 2;
  if (/(abbonamento|full)/i.test(eventName) && !/1\s*day|one\s*day/i.test(eventName)) return 3;
  return 1;
}

function getTicketCategory(eventName: string): string {
  if (/(abbonamento|full)/i.test(eventName) && !/1\s*day|one\s*day/i.test(eventName)) return 'Abbonamento';
  if (/2\s*days?/i.test(eventName)) return '2 Days';
  const dateMatch = eventName.match(/(\d{1,2})\s*(?:ago|agosto)/i);
  if (dateMatch) return `${dateMatch[1]} Ago`;
  return '1 Day';
}

export function WeeklySalesCard({ events }: WeeklySalesCardProps) {
  const [breakdown, setBreakdown] = useState<WeeklyBreakdownItem[]>([]);
  const [totals, setTotals] = useState<{ biglietti: number; presenze: number; eventsCount: number } | null>(null);
  const [dateLabel, setDateLabel] = useState('');

  const computeWeekly = useCallback(async () => {
    try {
      const cfEvents = events.filter(e => isCF14Event(e.name));
      if (cfEvents.length === 0) return;

      const today = new Date();
      const weekAgo = subDays(today, 7);
      const weekAgoStr = weekAgo.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

      // Try to find baseline from ~7 days ago
      const { data: weekAgoSnaps } = await supabase
        .from('ticket_snapshots')
        .select('event_id, event_name, tickets_sold, snapshot_date')
        .lte('snapshot_date', weekAgoStr)
        .order('snapshot_date', { ascending: false })
        .limit(100);

      const cf14WeekAgo = (weekAgoSnaps || []).filter(s => isCF14Event(s.event_name || ''));

      let baselineSnaps = cf14WeekAgo;
      let baselineDate: Date | null = null;

      if (cf14WeekAgo.length > 0) {
        baselineDate = new Date(cf14WeekAgo[0].snapshot_date + 'T00:00:00');
      } else {
        // No 7-day-old snapshot: use the earliest available snapshot as baseline
        const { data: earliestSnaps } = await supabase
          .from('ticket_snapshots')
          .select('event_id, event_name, tickets_sold, snapshot_date')
          .order('snapshot_date', { ascending: true })
          .limit(100);

        const cf14Earliest = (earliestSnaps || []).filter(s => isCF14Event(s.event_name || ''));
        if (cf14Earliest.length > 0) {
          baselineSnaps = cf14Earliest;
          baselineDate = new Date(cf14Earliest[0].snapshot_date + 'T00:00:00');
        }
      }

      // Build baseline map
      const baselineMap = new Map<string, number>();
      const seen = new Set<string>();
      for (const s of baselineSnaps) {
        if (s.event_id && !seen.has(s.event_id)) {
          seen.add(s.event_id);
          baselineMap.set(s.event_id, s.tickets_sold);
        }
      }

      if (baselineDate) {
        setDateLabel(`${format(baselineDate, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`);
      } else {
        setDateLabel(`${format(weekAgo, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`);
      }

      let totalBiglietti = 0;
      let totalPresenze = 0;
      const categoryMap = new Map<string, { ticketsDelta: number; presenzeDelta: number }>();

      for (const event of cfEvents) {
        const baselineSold = baselineMap.get(event.id) ?? event.ticketsSold;
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

      // Sort: Abbonamento first, then 2 Days, then dates
      const sortOrder = ['Abbonamento', '2 Days'];
      const items = Array.from(categoryMap.entries())
        .map(([label, data]) => ({ label, ...data }))
        .sort((a, b) => {
          const ai = sortOrder.indexOf(a.label);
          const bi = sortOrder.indexOf(b.label);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1;
          if (bi >= 0) return 1;
          return a.label.localeCompare(b.label);
        });

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
    <div className="col-span-2 soft-card-purple p-4 sm:p-5 transition-all duration-300 hover:scale-[1.02] hover:shadow-md">
      <div className="flex items-start justify-between mb-3 sm:mb-4">
        <div>
          <p className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ultima settimana</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <div className="p-2 sm:p-2.5 rounded-2xl bg-foreground/5">
          <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-0 sm:block sm:space-y-2.5 mb-3 sm:mb-4">
        <div className="flex flex-col sm:flex-row items-center sm:items-baseline sm:justify-between text-center sm:text-left">
          <span className="text-[10px] sm:text-xs text-muted-foreground order-2 sm:order-1">Eventi</span>
          <span className="text-lg sm:text-sm font-bold font-mono order-1 sm:order-2">{totals.eventsCount}</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center sm:items-baseline sm:justify-between text-center sm:text-left">
          <span className="text-[10px] sm:text-xs text-muted-foreground order-2 sm:order-1">Biglietti</span>
          <span className="text-lg sm:text-sm font-bold font-mono order-1 sm:order-2">+{totals.biglietti.toLocaleString('it-IT')}</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center sm:items-baseline sm:justify-between text-center sm:text-left">
          <span className="text-[10px] sm:text-xs text-muted-foreground order-2 sm:order-1">Presenze</span>
          <span className="text-lg sm:text-sm font-bold font-mono order-1 sm:order-2">+{totals.presenze.toLocaleString('it-IT')}</span>
        </div>
      </div>

      {breakdown.length > 0 && breakdown.some(item => item.ticketsDelta > 0) && (
        <div className="pt-3 border-t border-foreground/8 space-y-1.5 sm:space-y-2">
          <p className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Dettaglio per tipo</p>
          {breakdown.filter(item => item.ticketsDelta > 0).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[10px] sm:text-[11px]">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-mono font-semibold text-foreground">
                +{item.ticketsDelta} big. → {item.presenzeDelta} pres.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
