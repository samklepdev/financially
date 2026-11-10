import axios, {type AxiosInstance, type AxiosRequestConfig} from "axios";
import type {ApiErrorBody, ApiResponse, IBaseApiService} from "../types/api.ts";

export abstract class BaseApiService implements IBaseApiService {
    protected readonly http: AxiosInstance = axios.create({ baseURL: import.meta.env.VITE_BASE_API_URL })
    protected readonly path: string;

    constructor(path: string) {
        this.path = path;
    }

    /**
     * Retrieves all resources from the specified URL using the provided Axios request configuration.
     *
     * @template T
     * @param options The Axios request configuration to apply to the request.
     * @return A promise that resolves with the response data typed as T.
     */
    getAll<T>(options?: AxiosRequestConfig): Promise<T> {
        return this.#request<T>({...options, url: this.path});
    };

    /**
     * Retrieves a resource by its unique identifier.
     *
     * @template T
     * @param id The unique identifier of the resource to retrieve.
     * @param options The Axios request configuration to apply to the request.
     * @return A promise that resolves to the retrieved resource data.
     */
    getById<T>(id: string | number, options?: AxiosRequestConfig): Promise<T> {
        return this.#request<T>({...options, url: `${this.path}/${id}`})
    };

    /**
     * Sends a request to create a resource using the specified URL, request body, and Axios configuration.
     *
     * @param body The payload to include in the request.
     * @param options The Axios request configuration to apply to the request.
     * @return A promise that resolves with the created resource response data.
     */
    async create<T>(body: unknown, options?: AxiosRequestConfig): Promise<T> {
        return this.#request<T>({...options, method: 'POST', url: this.path, data: body});
    }

    /**
     * Sends an update request to the specified URL with the provided request body and configuration.
     *
     * @param id - The unique identifier of the resource to update.
     * @param body - The payload to send as the request data.
     * @param options - Axios request configuration options to apply to the request.
     * @return A promise that resolves with the response data typed as T.
     */
    async update<T>(id: string | number, body: unknown, options?: AxiosRequestConfig): Promise<T> {
        return this.#request<T>({...options, method: 'PUT', url: `${this.path}/${id}`, data: body})
    }

    /**
     * Sends a delete request to the specified URL using the provided Axios request configuration.
     *
     * @param id
     * @param options The Axios request configuration to apply to the request.
     * @return A promise that resolves when the request completes.
     */
    async delete(id: string | number, options?: AxiosRequestConfig): Promise<void> {
        // #send, not #request: a 204 has no body to check
        await this.#send<void>({...options, method: 'DELETE', url: `${this.path}/${id}`})
    }

    /**
     * Sends an HTTP request using the provided Axios configuration and returns the response payload data.
     *
     * @template T
     * @param config The Axios request configuration used to send the request.
     * @return The extracted data from the response.
     * @throws Error If the response does not contain data.
     */
    async #request<T>(config: AxiosRequestConfig): Promise<T> {
        const res = await this.#send<T>(config);
        if (res.data?.data === undefined) {
            throw new Error('No data in response')
        }
        return res.data.data
    }

    /**
     * Sends an HTTP request using the provided Axios configuration and returns the typed API response.
     *
     * @template T The expected data type contained in the API response.
     * @param config The Axios request configuration used to build and send the request.
     * @return A promise that resolves with the Axios response containing the typed API response.
     * @throws Error When the request fails with an Axios error, using the API error message when available.
     */
    async #send<T>(config: AxiosRequestConfig) {
        try {
            return await this.http.request<ApiResponse<T>>(config);
        } catch(error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, { cause: error })
            }
            throw error
        }
    }
}