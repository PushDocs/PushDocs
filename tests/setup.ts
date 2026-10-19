// Yarn loads the local installation's .env; individual tests control their request origin.
delete process.env.PUSHDOCS_PUBLIC_ORIGIN;
