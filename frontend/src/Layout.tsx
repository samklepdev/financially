import {NavLink, Outlet} from "react-router-dom";
import './Layout.css'

function navClass({isActive}: {isActive: boolean}) {
    return isActive ? 'tape-nav__link active' : 'tape-nav__link'
}

function Layout() {
    return (
        <div className="ledger-shell">
            <header className="ledger-tape">
                <NavLink to="/" className="wordmark">Financially</NavLink>
                <nav className="tape-nav" aria-label="Primary">
                    <NavLink to="/" end className={navClass}>Dashboard</NavLink>
                    <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
                </nav>
            </header>
            <main>
                <Outlet/>
            </main>
        </div>
    )
}

export default Layout
