import {Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {SpendPoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: SpendPoint[]};

function SpendingTrendChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Spending Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data}>
                    <XAxis dataKey="date" hide/>
                    <YAxis hide/>
                    <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                        contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                    />
                    <Area type="monotone" dataKey="spendCents" stroke="var(--debit)" fill="var(--debit)" fillOpacity={0.25}/>
                </AreaChart>
            </ResponsiveContainer>
        </article>
    );
}

export default SpendingTrendChart;
