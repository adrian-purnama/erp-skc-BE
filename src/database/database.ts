import mongoose from "mongoose";
import { logger } from "../logger/logger";





export async function connectDatabase(mongodbUrl : string, build : string):Promise<void>{
    try{
        await mongoose.connect(mongodbUrl, {
            dbName:build
        })
        logger.info(`Database Connected on ${build}`)
    }catch (error){
        logger.error(
            "Failed to connect to database","database/database.ts","connectDatabase"
        );

        throw error;
    }
}