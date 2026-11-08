import express, {type Request, type Response } from 'express';
import {transactionsRouter} from './routes/transactions.router.ts'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1/transactions', transactionsRouter)

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
});

// Listen on port 3000
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});