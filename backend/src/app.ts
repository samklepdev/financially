import express, {type Request, type Response} from 'express';
import {fileURLToPath} from 'node:url';
import {transactionsRouter} from './routes/transactions.router.ts'
import {categoriesRouter} from './routes/categories.router.ts'
import {categoryRulesRouter} from './routes/categoryRules.router.ts'
import {dashboardChatRouter} from './routes/dashboardChat.router.ts'
import {authRouter} from './routes/auth.router.ts'
import {requireAuth} from './middleware/requireAuth.ts'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/transactions', requireAuth, transactionsRouter)
app.use('/api/v1/categories', requireAuth, categoriesRouter)
app.use('/api/v1/category-rules', requireAuth, categoryRulesRouter)
app.use('/api/v1/dashboard', requireAuth, dashboardChatRouter)

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
});

// Only start listening when this file is run directly (e.g. `node src/app.ts`),
// not when a test imports it to get the `app` instance.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
