/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ────────────────────────────────────────────────────────────────

const BudgetIdSchema = z.object({
  budget_id: z.string().describe('The budget ID. Use "last-used" to use the last used budget.'),
});

const ListTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID. Use "last-used" to use the last used budget.'),
  since_date: z.string().optional().describe('ISO 8601 date (YYYY-MM-DD) to filter transactions on or after this date.'),
  type: z.enum(['uncategorized', 'unapproved']).optional().describe('Filter by transaction type.'),
});

const GetTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  transaction_id: z.string().describe('The transaction ID.'),
});

const CreateTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  account_id: z.string().describe('The account ID to create the transaction in.'),
  date: z.string().describe('The transaction date in ISO 8601 format (YYYY-MM-DD).'),
  amount: z.number().describe('The transaction amount in milliunits (e.g. -10000 = -$10.00, 25000 = $25.00).'),
  payee_name: z.string().optional().describe('The payee name. Will create a new payee if it does not exist.'),
  payee_id: z.string().optional().describe('The payee ID. Takes precedence over payee_name.'),
  category_id: z.string().optional().describe('The category ID to assign.'),
  memo: z.string().optional().describe('An optional memo for the transaction.'),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional().describe('The cleared status.'),
  approved: z.boolean().optional().describe('Whether the transaction is approved.'),
});

const UpdateTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  transaction_id: z.string().describe('The transaction ID to update.'),
  date: z.string().optional().describe('The transaction date in ISO 8601 format (YYYY-MM-DD).'),
  amount: z.number().optional().describe('The transaction amount in milliunits.'),
  payee_name: z.string().optional().describe('The payee name.'),
  payee_id: z.string().optional().describe('The payee ID.'),
  category_id: z.string().optional().describe('The category ID.'),
  memo: z.string().optional().describe('An optional memo.'),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional().describe('The cleared status.'),
  approved: z.boolean().optional().describe('Whether the transaction is approved.'),
});

const ListAccountTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  account_id: z.string().describe('The account ID.'),
  since_date: z.string().optional().describe('ISO 8601 date to filter transactions from.'),
});

const ListCategoryTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  category_id: z.string().describe('The category ID.'),
  since_date: z.string().optional().describe('ISO 8601 date to filter transactions from.'),
});

const GetCategorySchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  category_id: z.string().describe('The category ID.'),
});

const GetMonthCategorySchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  month: z.string().describe('The budget month in ISO 8601 format (YYYY-MM-01).'),
  category_id: z.string().describe('The category ID.'),
});

const UpdateMonthCategorySchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  month: z.string().describe('The budget month in ISO 8601 format (YYYY-MM-01).'),
  category_id: z.string().describe('The category ID.'),
  budgeted: z.number().describe('The budgeted amount in milliunits.'),
});

const GetBudgetMonthSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  month: z.string().describe('The budget month in ISO 8601 format (YYYY-MM-01). Use "current" for the current month.'),
});

const ListPayeesSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
});

const GetAccountSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  account_id: z.string().describe('The account ID.'),
});

const DeleteTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  transaction_id: z.string().describe('The transaction ID to delete.'),
});

const BulkCreateTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  transactions: z.array(z.object({
    account_id: z.string().describe('The account ID.'),
    date: z.string().describe('The transaction date (YYYY-MM-DD).'),
    amount: z.number().describe('Amount in milliunits (e.g. -10000 = -$10.00).'),
    payee_name: z.string().optional().describe('Payee name.'),
    payee_id: z.string().optional().describe('Payee ID.'),
    category_id: z.string().optional().describe('Category ID.'),
    memo: z.string().optional().describe('Memo.'),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
  })).describe('Array of transactions to create (max 1000).'),
});

const ImportTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID. Triggers import from linked accounts.'),
});

const GetPayeeSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  payee_id: z.string().describe('The payee ID.'),
});

const ListPayeeTransactionsSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  payee_id: z.string().describe('The payee ID.'),
  since_date: z.string().optional().describe('ISO 8601 date to filter transactions from.'),
});

const GetScheduledTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  scheduled_transaction_id: z.string().describe('The scheduled transaction ID.'),
});

const CreateScheduledTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  account_id: z.string().describe('The account ID.'),
  date: z.string().describe('The first occurrence date (YYYY-MM-DD).'),
  amount: z.number().describe('Amount in milliunits.'),
  frequency: z.enum([
    'never', 'daily', 'weekly', 'everyOtherWeek', 'twiceAMonth',
    'every4Weeks', 'monthly', 'everyOtherMonth', 'every3Months',
    'every4Months', 'twiceAYear', 'yearly', 'everyOtherYear',
  ]).describe('Recurrence frequency.'),
  payee_name: z.string().optional().describe('Payee name.'),
  payee_id: z.string().optional().describe('Payee ID.'),
  category_id: z.string().optional().describe('Category ID.'),
  memo: z.string().optional().describe('Memo.'),
});

const UpdateScheduledTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  scheduled_transaction_id: z.string().describe('The scheduled transaction ID to update.'),
  account_id: z.string().optional().describe('The account ID.'),
  date: z.string().optional().describe('The next occurrence date (YYYY-MM-DD).'),
  amount: z.number().optional().describe('Amount in milliunits.'),
  frequency: z.enum([
    'never', 'daily', 'weekly', 'everyOtherWeek', 'twiceAMonth',
    'every4Weeks', 'monthly', 'everyOtherMonth', 'every3Months',
    'every4Months', 'twiceAYear', 'yearly', 'everyOtherYear',
  ]).optional().describe('Recurrence frequency.'),
  payee_name: z.string().optional().describe('Payee name.'),
  payee_id: z.string().optional().describe('Payee ID.'),
  category_id: z.string().optional().describe('Category ID.'),
  memo: z.string().optional().describe('Memo.'),
});

const DeleteScheduledTransactionSchema = z.object({
  budget_id: z.string().describe('The budget ID.'),
  scheduled_transaction_id: z.string().describe('The scheduled transaction ID to delete.'),
});

// ─── Tool Definitions ────────────────────────────────────────────────────────

export function getYnabTools() {
  return [
    {
      name: 'ynab_list_budgets',
      description: 'List all budgets in the YNAB account.',
      inputSchema: zodToJsonSchema(z.object({})),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_budget',
      description: 'Get a single budget by ID, including settings and summary data.',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_budget_summary',
      description: 'Get a high-level summary of a budget (balances, activity, income, expenses).',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_accounts',
      description: 'List all accounts in a budget.',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_account',
      description: 'Get a single account by ID.',
      inputSchema: zodToJsonSchema(GetAccountSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_transactions',
      description: 'List transactions in a budget, optionally filtered by date or type.',
      inputSchema: zodToJsonSchema(ListTransactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_transaction',
      description: 'Get a single transaction by ID.',
      inputSchema: zodToJsonSchema(GetTransactionSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_create_transaction',
      description: 'Create a new transaction in a budget account.',
      inputSchema: zodToJsonSchema(CreateTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ynab_update_transaction',
      description: 'Update an existing transaction.',
      inputSchema: zodToJsonSchema(UpdateTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_account_transactions',
      description: 'List all transactions for a specific account.',
      inputSchema: zodToJsonSchema(ListAccountTransactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_category_transactions',
      description: 'List all transactions for a specific category.',
      inputSchema: zodToJsonSchema(ListCategoryTransactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_categories',
      description: 'List all categories grouped by category group for a budget.',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_category',
      description: 'Get a single category by ID.',
      inputSchema: zodToJsonSchema(GetCategorySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_month_category',
      description: 'Get the budgeted and activity amounts for a category in a specific month.',
      inputSchema: zodToJsonSchema(GetMonthCategorySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_update_month_category',
      description: 'Update the budgeted amount for a category in a specific month.',
      inputSchema: zodToJsonSchema(UpdateMonthCategorySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_budget_month',
      description: 'Get the overall budget data for a specific month including income, budgeted, and activity totals.',
      inputSchema: zodToJsonSchema(GetBudgetMonthSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_payees',
      description: 'List all payees in a budget.',
      inputSchema: zodToJsonSchema(ListPayeesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_payee',
      description: 'Get a single payee by ID.',
      inputSchema: zodToJsonSchema(GetPayeeSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_payee_transactions',
      description: 'List all transactions for a specific payee.',
      inputSchema: zodToJsonSchema(ListPayeeTransactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_delete_transaction',
      description: 'Delete a transaction by ID.',
      inputSchema: zodToJsonSchema(DeleteTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'ynab_bulk_create_transactions',
      description: 'Create multiple transactions at once (up to 1000). Returns duplicate import IDs if any already exist.',
      inputSchema: zodToJsonSchema(BulkCreateTransactionsSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ynab_import_transactions',
      description: 'Trigger import of transactions from linked bank accounts for a budget.',
      inputSchema: zodToJsonSchema(ImportTransactionsSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ynab_list_months',
      description: 'List all budget months for a budget.',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_list_scheduled_transactions',
      description: 'List all scheduled (recurring) transactions for a budget.',
      inputSchema: zodToJsonSchema(BudgetIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_get_scheduled_transaction',
      description: 'Get a single scheduled transaction by ID.',
      inputSchema: zodToJsonSchema(GetScheduledTransactionSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_create_scheduled_transaction',
      description: 'Create a new scheduled (recurring) transaction.',
      inputSchema: zodToJsonSchema(CreateScheduledTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ynab_update_scheduled_transaction',
      description: 'Update an existing scheduled transaction.',
      inputSchema: zodToJsonSchema(UpdateScheduledTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ynab_delete_scheduled_transaction',
      description: 'Delete a scheduled transaction by ID.',
      inputSchema: zodToJsonSchema(DeleteScheduledTransactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

function formatMilliunits(milliunits: number): string {
  return `$${(milliunits / 1000).toFixed(2)}`;
}

export async function callYnabTool(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance
) {
  switch (name) {
    case 'ynab_list_budgets': {
      const response = await client.get('/budgets');
      const budgets = response.data.data.budgets;
      if (!budgets || budgets.length === 0) {
        return { content: [{ type: 'text', text: 'No budgets found.' }] };
      }
      const list = budgets
        .map((b: any) => `ID: ${b.id} | Name: ${b.name} | Last Modified: ${b.last_modified_on}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${budgets.length} budgets:\n\n${list}` }] };
    }

    case 'ynab_get_budget': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}`);
      const b = response.data.data.budget;
      return {
        content: [
          {
            type: 'text',
            text: `Budget: ${b.name}\nID: ${b.id}\nCurrency: ${b.currency_format?.iso_code || 'USD'}\nDate Format: ${b.date_format?.format}\nLast Modified: ${b.last_modified_on}`,
          },
        ],
      };
    }

    case 'ynab_get_budget_summary': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/summary`);
      const s = response.data.data;
      return {
        content: [
          {
            type: 'text',
            text: `Budget Summary for ${budget_id}:\nIncome: ${formatMilliunits(s.income || 0)}\nBudgeted: ${formatMilliunits(s.budgeted || 0)}\nActivity: ${formatMilliunits(s.activity || 0)}\nTo Be Budgeted: ${formatMilliunits(s.to_be_budgeted || 0)}`,
          },
        ],
      };
    }

    case 'ynab_list_accounts': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/accounts`);
      const accounts = response.data.data.accounts;
      if (!accounts || accounts.length === 0) {
        return { content: [{ type: 'text', text: 'No accounts found.' }] };
      }
      const list = accounts
        .filter((a: any) => !a.deleted)
        .map((a: any) => `ID: ${a.id} | Name: ${a.name} | Type: ${a.type} | Balance: ${formatMilliunits(a.balance)} | On Budget: ${a.on_budget}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${accounts.length} accounts:\n\n${list}` }] };
    }

    case 'ynab_get_account': {
      const { budget_id, account_id } = GetAccountSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/accounts/${account_id}`);
      const a = response.data.data.account;
      return {
        content: [
          {
            type: 'text',
            text: `Account: ${a.name}\nID: ${a.id}\nType: ${a.type}\nBalance: ${formatMilliunits(a.balance)}\nCleared Balance: ${formatMilliunits(a.cleared_balance)}\nUncleared Balance: ${formatMilliunits(a.uncleared_balance)}\nOn Budget: ${a.on_budget}\nClosed: ${a.closed}`,
          },
        ],
      };
    }

    case 'ynab_list_transactions': {
      const parsed = ListTransactionsSchema.parse(args);
      const params: Record<string, any> = {};
      if (parsed.since_date) params.since_date = parsed.since_date;
      if (parsed.type) params.type = parsed.type;
      const response = await client.get(`/budgets/${parsed.budget_id}/transactions`, { params });
      const transactions = response.data.data.transactions;
      if (!transactions || transactions.length === 0) {
        return { content: [{ type: 'text', text: 'No transactions found.' }] };
      }
      const list = transactions
        .slice(0, 50)
        .map((t: any) => `ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)} | Payee: ${t.payee_name || 'N/A'} | Category: ${t.category_name || 'N/A'} | Memo: ${t.memo || ''}`)
        .join('\n');
      return {
        content: [
          { type: 'text', text: `Found ${transactions.length} transactions (showing up to 50):\n\n${list}` },
        ],
      };
    }

    case 'ynab_get_transaction': {
      const { budget_id, transaction_id } = GetTransactionSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/transactions/${transaction_id}`);
      const t = response.data.data.transaction;
      return {
        content: [
          {
            type: 'text',
            text: `Transaction: ${t.id}\nDate: ${t.date}\nAmount: ${formatMilliunits(t.amount)}\nPayee: ${t.payee_name || 'N/A'}\nCategory: ${t.category_name || 'N/A'}\nMemo: ${t.memo || ''}\nCleared: ${t.cleared}\nApproved: ${t.approved}\nAccount: ${t.account_name}`,
          },
        ],
      };
    }

    case 'ynab_create_transaction': {
      const parsed = CreateTransactionSchema.parse(args);
      const { budget_id, ...txData } = parsed;
      const response = await client.post(`/budgets/${budget_id}/transactions`, {
        transaction: txData,
      });
      const t = response.data.data.transaction;
      return {
        content: [
          { type: 'text', text: `Transaction created. ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)}` },
        ],
      };
    }

    case 'ynab_update_transaction': {
      const parsed = UpdateTransactionSchema.parse(args);
      const { budget_id, transaction_id, ...txData } = parsed;
      const response = await client.put(`/budgets/${budget_id}/transactions/${transaction_id}`, {
        transaction: txData,
      });
      const t = response.data.data.transaction;
      return {
        content: [
          { type: 'text', text: `Transaction updated. ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)}` },
        ],
      };
    }

    case 'ynab_list_account_transactions': {
      const parsed = ListAccountTransactionsSchema.parse(args);
      const params: Record<string, any> = {};
      if (parsed.since_date) params.since_date = parsed.since_date;
      const response = await client.get(`/budgets/${parsed.budget_id}/accounts/${parsed.account_id}/transactions`, { params });
      const transactions = response.data.data.transactions;
      if (!transactions || transactions.length === 0) {
        return { content: [{ type: 'text', text: 'No transactions found for this account.' }] };
      }
      const list = transactions
        .slice(0, 50)
        .map((t: any) => `ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)} | Payee: ${t.payee_name || 'N/A'} | Category: ${t.category_name || 'N/A'}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${transactions.length} transactions:\n\n${list}` }] };
    }

    case 'ynab_list_category_transactions': {
      const parsed = ListCategoryTransactionsSchema.parse(args);
      const params: Record<string, any> = {};
      if (parsed.since_date) params.since_date = parsed.since_date;
      const response = await client.get(`/budgets/${parsed.budget_id}/categories/${parsed.category_id}/transactions`, { params });
      const transactions = response.data.data.transactions;
      if (!transactions || transactions.length === 0) {
        return { content: [{ type: 'text', text: 'No transactions found for this category.' }] };
      }
      const list = transactions
        .slice(0, 50)
        .map((t: any) => `ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)} | Payee: ${t.payee_name || 'N/A'}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${transactions.length} transactions:\n\n${list}` }] };
    }

    case 'ynab_list_categories': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/categories`);
      const groups = response.data.data.category_groups;
      if (!groups || groups.length === 0) {
        return { content: [{ type: 'text', text: 'No categories found.' }] };
      }
      const list = groups
        .filter((g: any) => !g.deleted)
        .map((g: any) => {
          const cats = g.categories
            .filter((c: any) => !c.deleted)
            .map((c: any) => `  - ${c.name} (ID: ${c.id}) | Budgeted: ${formatMilliunits(c.budgeted)} | Activity: ${formatMilliunits(c.activity)} | Balance: ${formatMilliunits(c.balance)}`)
            .join('\n');
          return `${g.name}:\n${cats}`;
        })
        .join('\n\n');
      return { content: [{ type: 'text', text: list }] };
    }

    case 'ynab_get_category': {
      const { budget_id, category_id } = GetCategorySchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/categories/${category_id}`);
      const c = response.data.data.category;
      return {
        content: [
          {
            type: 'text',
            text: `Category: ${c.name}\nID: ${c.id}\nGroup: ${c.category_group_name}\nBudgeted: ${formatMilliunits(c.budgeted)}\nActivity: ${formatMilliunits(c.activity)}\nBalance: ${formatMilliunits(c.balance)}\nGoal Type: ${c.goal_type || 'None'}`,
          },
        ],
      };
    }

    case 'ynab_get_month_category': {
      const { budget_id, month, category_id } = GetMonthCategorySchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/months/${month}/categories/${category_id}`);
      const c = response.data.data.category;
      return {
        content: [
          {
            type: 'text',
            text: `Category: ${c.name} (${month})\nBudgeted: ${formatMilliunits(c.budgeted)}\nActivity: ${formatMilliunits(c.activity)}\nBalance: ${formatMilliunits(c.balance)}`,
          },
        ],
      };
    }

    case 'ynab_update_month_category': {
      const { budget_id, month, category_id, budgeted } = UpdateMonthCategorySchema.parse(args);
      const response = await client.patch(`/budgets/${budget_id}/months/${month}/categories/${category_id}`, {
        category: { budgeted },
      });
      const c = response.data.data.category;
      return {
        content: [
          { type: 'text', text: `Category "${c.name}" updated for ${month}. Budgeted: ${formatMilliunits(c.budgeted)}` },
        ],
      };
    }

    case 'ynab_get_budget_month': {
      const { budget_id, month } = GetBudgetMonthSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/months/${month}`);
      const m = response.data.data.month;
      return {
        content: [
          {
            type: 'text',
            text: `Budget Month: ${m.month}\nIncome: ${formatMilliunits(m.income)}\nBudgeted: ${formatMilliunits(m.budgeted)}\nActivity: ${formatMilliunits(m.activity)}\nTo Be Budgeted: ${formatMilliunits(m.to_be_budgeted)}\nAge of Money: ${m.age_of_money ?? 'N/A'} days`,
          },
        ],
      };
    }

    case 'ynab_list_payees': {
      const { budget_id } = ListPayeesSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/payees`);
      const payees = response.data.data.payees;
      if (!payees || payees.length === 0) {
        return { content: [{ type: 'text', text: 'No payees found.' }] };
      }
      const list = payees
        .filter((p: any) => !p.deleted)
        .map((p: any) => `ID: ${p.id} | Name: ${p.name}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${payees.length} payees:\n\n${list}` }] };
    }

    case 'ynab_get_payee': {
      const { budget_id, payee_id } = GetPayeeSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/payees/${payee_id}`);
      const p = response.data.data.payee;
      return {
        content: [
          { type: 'text', text: `Payee: ${p.name}\nID: ${p.id}\nTransfer Account ID: ${p.transfer_account_id || 'N/A'}` },
        ],
      };
    }

    case 'ynab_list_payee_transactions': {
      const parsed = ListPayeeTransactionsSchema.parse(args);
      const params: Record<string, any> = {};
      if (parsed.since_date) params.since_date = parsed.since_date;
      const response = await client.get(`/budgets/${parsed.budget_id}/payees/${parsed.payee_id}/transactions`, { params });
      const transactions = response.data.data.transactions;
      if (!transactions || transactions.length === 0) {
        return { content: [{ type: 'text', text: 'No transactions found for this payee.' }] };
      }
      const list = transactions
        .slice(0, 50)
        .map((t: any) => `ID: ${t.id} | Date: ${t.date} | Amount: ${formatMilliunits(t.amount)} | Category: ${t.category_name || 'N/A'} | Memo: ${t.memo || ''}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${transactions.length} transactions:\n\n${list}` }] };
    }

    case 'ynab_delete_transaction': {
      const { budget_id, transaction_id } = DeleteTransactionSchema.parse(args);
      await client.delete(`/budgets/${budget_id}/transactions/${transaction_id}`);
      return {
        content: [{ type: 'text', text: `Transaction ${transaction_id} deleted successfully.` }],
      };
    }

    case 'ynab_bulk_create_transactions': {
      const { budget_id, transactions } = BulkCreateTransactionsSchema.parse(args);
      const response = await client.post(`/budgets/${budget_id}/transactions`, { transactions });
      const result = response.data.data;
      const created = result.transactions?.length || 0;
      const duplicates = result.duplicate_import_ids?.length || 0;
      return {
        content: [
          { type: 'text', text: `Created ${created} transactions.${duplicates > 0 ? ` ${duplicates} duplicates skipped.` : ''}` },
        ],
      };
    }

    case 'ynab_import_transactions': {
      const { budget_id } = ImportTransactionsSchema.parse(args);
      const response = await client.post(`/budgets/${budget_id}/transactions/import`);
      const ids = response.data.data.transaction_ids || [];
      return {
        content: [{ type: 'text', text: `Import triggered. ${ids.length} transactions imported.` }],
      };
    }

    case 'ynab_list_months': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/months`);
      const months = response.data.data.months;
      if (!months || months.length === 0) {
        return { content: [{ type: 'text', text: 'No budget months found.' }] };
      }
      const list = months
        .map((m: any) => `Month: ${m.month} | Income: ${formatMilliunits(m.income)} | Budgeted: ${formatMilliunits(m.budgeted)} | Activity: ${formatMilliunits(m.activity)} | TBB: ${formatMilliunits(m.to_be_budgeted)}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${months.length} months:\n\n${list}` }] };
    }

    case 'ynab_list_scheduled_transactions': {
      const { budget_id } = BudgetIdSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/scheduled_transactions`);
      const scheduled = response.data.data.scheduled_transactions;
      if (!scheduled || scheduled.length === 0) {
        return { content: [{ type: 'text', text: 'No scheduled transactions found.' }] };
      }
      const list = scheduled
        .filter((s: any) => !s.deleted)
        .map((s: any) => `ID: ${s.id} | Date: ${s.date_next} | Amount: ${formatMilliunits(s.amount)} | Payee: ${s.payee_name || 'N/A'} | Frequency: ${s.frequency} | Category: ${s.category_name || 'N/A'}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${scheduled.length} scheduled transactions:\n\n${list}` }] };
    }

    case 'ynab_get_scheduled_transaction': {
      const { budget_id, scheduled_transaction_id } = GetScheduledTransactionSchema.parse(args);
      const response = await client.get(`/budgets/${budget_id}/scheduled_transactions/${scheduled_transaction_id}`);
      const s = response.data.data.scheduled_transaction;
      return {
        content: [
          {
            type: 'text',
            text: `Scheduled Transaction: ${s.id}\nDate Next: ${s.date_next}\nAmount: ${formatMilliunits(s.amount)}\nFrequency: ${s.frequency}\nPayee: ${s.payee_name || 'N/A'}\nCategory: ${s.category_name || 'N/A'}\nMemo: ${s.memo || ''}\nAccount: ${s.account_name}`,
          },
        ],
      };
    }

    case 'ynab_create_scheduled_transaction': {
      const parsed = CreateScheduledTransactionSchema.parse(args);
      const { budget_id, ...txData } = parsed;
      const response = await client.post(`/budgets/${budget_id}/scheduled_transactions`, {
        scheduled_transaction: txData,
      });
      const s = response.data.data.scheduled_transaction;
      return {
        content: [
          { type: 'text', text: `Scheduled transaction created. ID: ${s.id} | Next: ${s.date_next} | Frequency: ${s.frequency}` },
        ],
      };
    }

    case 'ynab_update_scheduled_transaction': {
      const parsed = UpdateScheduledTransactionSchema.parse(args);
      const { budget_id, scheduled_transaction_id, ...txData } = parsed;
      const response = await client.put(`/budgets/${budget_id}/scheduled_transactions/${scheduled_transaction_id}`, {
        scheduled_transaction: txData,
      });
      const s = response.data.data.scheduled_transaction;
      return {
        content: [
          { type: 'text', text: `Scheduled transaction updated. ID: ${s.id} | Next: ${s.date_next} | Frequency: ${s.frequency}` },
        ],
      };
    }

    case 'ynab_delete_scheduled_transaction': {
      const { budget_id, scheduled_transaction_id } = DeleteScheduledTransactionSchema.parse(args);
      await client.delete(`/budgets/${budget_id}/scheduled_transactions/${scheduled_transaction_id}`);
      return {
        content: [{ type: 'text', text: `Scheduled transaction ${scheduled_transaction_id} deleted successfully.` }],
      };
    }

    default:
      return null;
  }
}
