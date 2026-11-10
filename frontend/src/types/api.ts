import type {AxiosRequestConfig} from "axios";

export type ApiResponse<T> = { data: T };
export type ApiErrorBody = { error: string };

export interface IBaseApiService {
    getAll<T>(url: string, config?: AxiosRequestConfig): Promise<T>
    getById<T>(url: string, id: string | number, config?: AxiosRequestConfig): Promise<T>
    create<T>(url: string, body: unknown, config?: AxiosRequestConfig): Promise<T>
    update<T>(url: string, id: string | number, body: unknown, config?: AxiosRequestConfig): Promise<T>
    delete(url: string, config?: AxiosRequestConfig): Promise<void>
}