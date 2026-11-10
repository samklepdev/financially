import type {AxiosRequestConfig} from "axios";

export type ApiResponse<T> = { data: T };
export type ApiErrorBody = { error: string };

export interface IBaseApiService {
    getAll<T>(config?: AxiosRequestConfig): Promise<T>
    getById<T>(id: string | number, config?: AxiosRequestConfig): Promise<T>
    create<T>(body: unknown, config?: AxiosRequestConfig): Promise<T>
    update<T>(id: string | number, body: unknown, config?: AxiosRequestConfig): Promise<T>
    delete(id: string | number, config?: AxiosRequestConfig): Promise<void>
}