import express from "express";
import {postChatMessage} from "../controllers/dashboardChat.controller.ts";

export const dashboardChatRouter = express.Router();

dashboardChatRouter.post('/chat', postChatMessage);
