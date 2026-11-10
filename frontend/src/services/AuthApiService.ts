import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody} from "../types/api.ts";

export class AuthApiService {
    private readonly http: AxiosInstance = axios.create({
        baseURL: import.meta.env.VITE_BASE_API_URL,
        withCredentials: true,
    })

    /**
     * Logs in with the app password. Throws if the password is wrong.
     */
    async login(password: string): Promise<void> {
        await this.#send(() => this.http.post('/auth/login', {password}));
    }

    /**
     * Logs out, clearing the session on the server and the cookie in the browser.
     */
    async logout(): Promise<void> {
        await this.#send(() => this.http.post('/auth/logout'));
    }

    /**
     * Checks whether the current session cookie (if any) is still valid.
     *
     * @return True if authenticated, false otherwise — never throws.
     */
    async me(): Promise<boolean> {
        try {
            await this.http.get('/auth/me');
            return true;
        } catch {
            return false;
        }
    }

    async #send(request: () => Promise<unknown>): Promise<void> {
        try {
            await request();
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }
}

export const authApiService = new AuthApiService();
