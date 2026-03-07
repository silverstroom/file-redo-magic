import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { it } from 'date-fns/locale';
import type { DiceEventRaw } from '@/lib/ticket-utils';

interface WeeklySalesCardProps {
  events: DiceEventRaw[];
  weeklyTicketCounts: Record<string, number> | null;
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

export function WeeklySalesCard({ events, weeklyTicketCounts }: WeeklySalesCardProps) {
  const today = new Date();
  const weekAgo = subDays(today, 7);
  const dateLabel = `${format(weekAgo, 'd MMM', { locale: it })} - ${format(today, 'd MMM', { locale: it })}`;

  const { totals, breakdown } = useMemo(() => {
    const cfEvents = events.filter(e => isCF14Event(e.name));
    if (cfEvents.length === 0 || !weeklyTicketCounts) {
      return { totals: null, breakdown: [] };
    }

    let totalBiglietti = 0;
    let totalPresenze = 0;
    const categoryMap = new Map<string, { ticketsDelta: number; presenzeDelta: number }>();

    for (const event of cfEvents) {
      const delta = weeklyTicketCounts[event.id] ?? 0;
      const presenze = delta * getPresenzeMultiplier(event.name);

      totalBiglietti += delta;
      totalPresenze += presenze;

      if (delta > 0) {
        const category = getTicketCategory(event.name);
        const existing = categoryMap.get(category) || { ticketsDelta: 0, presenzeDelta: 0 };
        categoryMap.set(category, {
          ticketsDelta: existing.ticketsDelta + delta,
          presenzeDelta: existing.presenzeDelta + presenze,
        });
      }
    }

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

    return {
      totals: { biglietti: totalBiglietti, presenze: totalPresenze, eventsCount: cfEvents.length },
      breakdown: items,
    };
  }, [events, weeklyTicketCounts]);

  if (!totals) return null;

  return (
    <div className="col-span-2 soft-card-purple p-4 sm:p-5 transition-all duration-300 hover:scale-[1.02] hover:shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ultima settimana</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <div className="p-2 rounded-2xl bg-foreground/5">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <p className="text-xl font-bold font-mono">{totals.eventsCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Eventi</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono">+{totals.biglietti.toLocaleString('it-IT')}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Biglietti</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold font-mono">+{totals.presenze.toLocaleString('it-IT')}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Presenze</p>
        </div>
      </div>

      {breakdown.length > 0 && (
        <div className="pt-3 border-t border-foreground/8 space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dettaglio per tipo</p>
          {breakdown.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
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
