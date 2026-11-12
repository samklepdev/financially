import {Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {IncomePoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: IncomePoint[]};

function IncomeTrendChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Income Trend</h3>
            {data.length === 0 ? (
                <p className="chart-empty">No data yet</p>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data}>
                        <XAxis dataKey="date" hide/>
                        <YAxis hide/>
                        <Tooltip
                            formatter={(value) => formatMoney(Number(value))}
                            contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                        />
                        <Area type="monotone" dataKey="incomeCents" name="Income" stroke="var(--credit)" fill="var(--credit)" fillOpacity={0.25}/>
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </article>
    );
}

export default IncomeTrendChart;
