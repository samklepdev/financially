import {Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {NetCashFlowPoint} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: NetCashFlowPoint[]};

function NetCashFlowChart({data}: Props) {
    return (
        <article className="chart-card">
            <h3 className="chart-card__title">Net Cash Flow</h3>
            {data.length === 0 ? (
                <p className="chart-empty">No data yet</p>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data}>
                        <XAxis dataKey="label" tick={{fontSize: 11}}/>
                        <YAxis hide/>
                        <Tooltip
                            formatter={(value) => formatMoney(Number(value))}
                            contentStyle={{background: 'var(--ink-raised)', border: '1px solid var(--rule-on-ink)', borderRadius: 6}}
                            labelStyle={{color: 'var(--text-on-ink)'}}
                            itemStyle={{color: 'var(--text-on-ink-strong)'}}
                            cursor={{fill: 'var(--rule-on-ink)', opacity: 0.2}}
                        />
                        <Bar dataKey="netCents" name="Net">
                            {data.map((d) => (
                                <Cell key={d.month} fill={d.netCents >= 0 ? 'var(--credit)' : 'var(--debit)'}/>
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            )}
        </article>
    );
}

export default NetCashFlowChart;
