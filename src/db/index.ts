import mongoose from 'mongoose'
import dotenv from 'dotenv';
dotenv.config();

const mongoDbUrl = process.env.MONGODB_URL;

if (!mongoDbUrl) {
    throw new Error('MONGODB_URL missing env variable');
}

const connectDB = async () => {
    try {
        await mongoose.connect(mongoDbUrl)
        console.log('DB connected')
    } catch (error) {
        console.error('DB connection error:', error)
        process.exit(1)
    }
}

const closeDB = async () => {
    try {
        await mongoose.disconnect()
        console.log('DB disconnected')
    } catch (error) {
        console.error('DB disconnection error:', error)
        throw error;
    }
}

export { closeDB, connectDB };
