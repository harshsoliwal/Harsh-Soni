import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatInr } from '../lib/pricing';

export function McxTickerBar() {
  const { mcxRate, mcxLoading, mcxError, refreshMcxRate } = useApp();

  const formattedTime = mcxRate?.lastUpdatedAt
    ? new Date(mcxRate.lastUpdatedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    : 'Unavailable';

  const isDelayedOrManual = !mcxRate || mcxRate.isDelayed || mcxRate.isManualOverride;

  return (
    <div className="bg-[#111318] text-[#F5F4F0] border-b border-[#262932]">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <div className="flex items-center gap-2 font-medium tracking-wide">
            {isDelayedOrManual ? (
              <span className="inline-flex items-center gap-1.5 text-[#FBBF24]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {mcxRate?.isManualOverride
                  ? 'Delayed / Manual Reference Rate'
                  : 'Delayed / Manual Reference Rate'}
              </span>
            ) : (
              <span className="text-[#C99D44] font-semibold">Live MCX Reference</span>
            )}
          </div>

          {mcxRate ? (
            <>
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span className="text-[#9E9B93]">Gold 999 (10g)</span>
                <span className="text-white font-semibold">{formatInr(mcxRate.gold999Per10g)}</span>
                <span className="text-[#6F6D67]">·</span>
                <span className="text-[#9E9B93]">1g</span>
                <span className="text-[#E6E4DD]">{formatInr(mcxRate.gold999Per1g)}</span>
              </div>

              <div className="hidden lg:flex items-center gap-2 font-mono tabular-nums">
                <span className="text-[#9E9B93]">Gold 995 (10g)</span>
                <span className="text-[#E6E4DD]">{formatInr(mcxRate.gold995Per10g)}</span>
              </div>

              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span className="text-[#9E9B93]">Silver 999 (1kg)</span>
                <span className="text-white font-semibold">{formatInr(mcxRate.silver999Per1kg)}</span>
                <span className="text-[#6F6D67]">·</span>
                <span className="text-[#9E9B93]">100g</span>
                <span className="text-[#E6E4DD]">{formatInr(mcxRate.silver999Per100g)}</span>
              </div>
            </>
          ) : (
            <span className="text-[#FBBF24]">
              {mcxLoading
                ? 'Fetching live public MCX bullion benchmarks...'
                : mcxError || 'Public MCX feed unreachable. No fabricated rates displayed.'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-[#A4A199] font-mono tabular-nums shrink-0">
          <span>Updated {formattedTime}</span>
          <button
            type="button"
            onClick={() => refreshMcxRate(true)}
            disabled={mcxLoading}
            className="inline-flex items-center gap-1.5 text-[#F5F4F0] hover:text-[#C99D44] transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${mcxLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
