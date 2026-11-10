import {Navigate, Outlet} from "react-router-dom";
import {useAuth} from "./AuthContext.tsx";

function RequireAuth() {
    const {authenticated, loading} = useAuth();

    if (loading) {
        return null;
    }

    if (!authenticated) {
        return <Navigate to="/login" replace/>;
    }

    return <Outlet/>;
}

export default RequireAuth
