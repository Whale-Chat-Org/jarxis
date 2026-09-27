import 'dotenv/config';
if (
  !process.env.DATABASE_URL ||
  !/^\/jarxis_test(?:_[a-z0-9]+)*$/.test(new URL(process.env.DATABASE_URL).pathname)
)
  throw new Error('Integration tests require a dedicated DATABASE_URL containing jarxis_test');
Object.assign(process.env, { NODE_ENV: 'test' });
