import express, {type Request, type Response } from 'express';
import { db } from './db.ts';

const app = express();

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});