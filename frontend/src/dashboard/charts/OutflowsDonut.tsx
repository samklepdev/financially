import {Cell, Pie, PieChart, ResponsiveContainer} from "recharts";
import type {CategoryOutflow} from "../../helpers/dashboardMetrics.ts";
import {formatMoney} from "../../helpers/money.ts";

type Props = {data: CategoryOutflow[]};

function OutflowsDonut({data}: Props) {
    const total = data.reduce((sum, c) => sum + c.totalCents, 0);

    return (
        <article className="chart-card chart-card--donut">
            <h3 className="chart-card__title">Outflows</h3>
            <div className="outflows-donut">
                <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="totalCents"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={data.length > 1 ? 2 : 0}
                            stroke="none"
                        >
                            {data.map((entry) => (
                                <Cell key={entry.categoryId ?? 'uncategorized'} fill={entry.color}/>
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="outflows-total">
                    <span className="outflows-total__label">Total</span>
                    <span className="outflows-total__value">{formatMoney(total)}</span>
                </div>
            </div>
            <table className="outflows-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Value</th>
                        <th>Weight</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((c) => (
                        <tr key={c.categoryId ?? 'uncategorized'}>
                            <td>
                                <span className="outflows-swatch" style={{background: c.color}}/>
                                {c.name}
                            </td>
                            <td>{formatMoney(c.totalCents)}</td>
                            <td>{(c.weight * 100).toFixed(1)}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </article>
    );
}

export default OutflowsDonut;
