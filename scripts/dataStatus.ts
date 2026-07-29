import {localGrantIndex} from "../src/repositories/localGrantIndex.js";

const status=localGrantIndex.status();
console.log(JSON.stringify(status,null,2));
if(!status.available){
 console.log("\nBuild the local index with: npm run data:ingest:grants");
 process.exitCode=2;
}
