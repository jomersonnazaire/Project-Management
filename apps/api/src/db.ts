import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string, dbName?: string): Promise<typeof mongoose> {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  // Build indexes declared on the schemas (unique email, TTL on sessions, ...).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbState(): 'up' | 'down' {
  return mongoose.connection.readyState === 1 ? 'up' : 'down';
}
