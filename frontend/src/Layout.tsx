import {NavLink, Outlet, useNavigate} from "react-router-dom";
import {useAuth} from "./auth/AuthContext.tsx";
import './Layout.css'

function navClass({isActive}: {isActive: boolean}) {
    return isActive ? 'tape-nav__link active' : 'tape-nav__link'
}

function Layout() {
    const {logout} = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/');
    }

    return (
        <div className="ledger-shell">
            <header className="ledger-tape">
                <NavLink to="/dashboard" className="wordmark">Financially</NavLink>
                <nav className="tape-nav" aria-label="Primary">
                    <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
                    <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
                </nav>
                <button type="button" className="logout-button" onClick={handleLogout}>
                    Log out
                </button>
            </header>
            <main>
                <Outlet/>
            </main>
        </div>
    )
}

export default Layout
