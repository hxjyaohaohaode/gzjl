import "dotenv/config";

/**
 * Deliberately a successful no-op.
 *
 * A production-ready repository must not carry fabricated accounts, project
 * histories, payroll records, evidence, or AI reports that could be mistaken
 * for company data. The first organization and its unique Owner are created
 * through the guarded /setup flow after migrations finish; all other members
 * arrive through organization white-list invitations.
 *
 * Test fixtures belong in test files and are never loaded by this command.
 */
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Database seeding is disabled in production. Initialize the unique Owner through /setup.",
  );
}

process.stdout.write(
  "No demo accounts or business records are shipped. Use /setup to create the first Owner.\n",
);
