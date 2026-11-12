import {Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {BalancePoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: BalancePoint[]};

function RunningBalanceChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Running Balance</h3>
            {data.length === 0 ? (
                <p className="chart-empty">No data yet</p>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data}>
                        <XAxis dataKey="date" hide/>
                        <YAxis hide domain={['auto', 'auto']}/>
                        <Tooltip
                            formatter={(value) => formatMoney(Number(value))}
                            contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                        />
                        <Line type="monotone" dataKey="balanceCents" name="Balance" stroke="var(--credit)" strokeWidth={2} dot={false}/>
                    </LineChart>
                </ResponsiveContainer>
            )}
        </article>
    );
}

export default RunningBalanceChart;
