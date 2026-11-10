import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import {authApiService} from "../services/AuthApiService.ts";

type AuthState = {
    authenticated: boolean;
    loading: boolean;
    login: (password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({children}: {children: ReactNode}) {
    const [authenticated, setAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        authApiService.me()
            .then(setAuthenticated)
            .finally(() => setLoading(false));
    }, []);

    async function login(password: string) {
        await authApiService.login(password);
        setAuthenticated(true);
    }

    async function logout() {
        await authApiService.logout();
        setAuthenticated(false);
    }

    return (
        <AuthContext.Provider value={{authenticated, loading, login, logout}}>
            {children}
        </AuthContext.Provider>
    )
}

/**
 * @throws Error if called outside an AuthProvider.
 */
export function useAuth(): AuthState {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }

    return ctx;
}
