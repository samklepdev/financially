import {useState, type FormEvent} from "react";
import {useNavigate} from "react-router-dom";
import {useAuth} from "./AuthContext.tsx";
import './Login.css'

function Login() {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const {login} = useAuth();
    const navigate = useNavigate();

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            await login(password);
            navigate('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="login-shell">
            <form className="login-card" onSubmit={handleSubmit}>
                <span className="login-wordmark">Financially</span>
                <label className="login-field">
                    <span>Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoFocus
                        required
                    />
                </label>
                {error && <p className="login-error">{error}</p>}
                <button type="submit" disabled={submitting}>
                    {submitting ? 'Checking…' : 'Log in'}
                </button>
            </form>
        </div>
    )
}

export default Login
