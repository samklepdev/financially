import type {DashboardRange} from "../helpers/dashboardMetrics.ts";
import './dashboard.css';

const RANGES: {value: DashboardRange; label: string}[] = [
    {value: '30d', label: '30D'},
    {value: '90d', label: '90D'},
    {value: '1y', label: '1Y'},
    {value: 'all', label: 'All'},
];

type Props = {
    value: DashboardRange;
    onChange: (range: DashboardRange) => void;
};

function RangeSelect({value, onChange}: Props) {
    return (
        <div className="range-select" role="group" aria-label="Chart time range">
            {RANGES.map((r) => (
                <button
                    key={r.value}
                    type="button"
                    className={r.value === value ? 'range-select__option active' : 'range-select__option'}
                    onClick={() => onChange(r.value)}
                    aria-pressed={r.value === value}
                >
                    {r.label}
                </button>
            ))}
        </div>
    );
}

export default RangeSelect;
