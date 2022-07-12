const fs = require("node:fs");
const jimp = require("jimp");
const readline = require('node:readline');
const path = require("node:path");
const zlib = require("node:zlib");

class RTFileHeader {
    constructor() {
        this.fileTypeId;
        this.version;
        this.reversed;
    }

    serialize(buffer, pos = 0) {
        this.fileTypeId = buffer.subarray(pos, 6).toString();
        pos += 6;

        this.version = buffer.readInt8(pos);
        pos += 1;

        // reverse : uint8_t
        pos += 1;
        return pos;
    }
}

class RTPackHeader {
    constructor() {
        this.rtFileHeader;
        this.compressedSize;
        this.decompressedSize;
        this.compressionType;
        this.reversed;
    }

    serialize(buffer, pos = 0) {
        this.rtFileHeader = new RTFileHeader();
        pos = this.rtFileHeader.serialize(buffer, pos);

        this.compressedSize = buffer.readInt32LE(pos);
        pos += 4;

        this.decompressedSize = buffer.readInt32LE(pos);
        pos += 4;

        this.compressionType = buffer.readInt8(pos);
        pos += 1;

        // reverse : uint8_t[15]
        pos += 15;
        return pos;
    }
}

class RTTEXHeader {
    constructor() {
        this.rtFileHeader;
        this.height;
        this.width;
        this.format;
        this.originalHeight;
        this.originalWidth;
        this.usesAlpha;
        this.aleardyCompressed;
        this.reversedFlags;
        this.mipmapCount;
        this.reversed;
    }

    serialize(buffer, pos = 0) {
        this.rtFileHeader = new RTFileHeader();
        pos = this.rtFileHeader.serialize(buffer, pos);

        this.height = buffer.readInt32LE(pos);
        pos += 4;

        this.width = buffer.readInt32LE(pos);
        pos += 4;

        this.format = buffer.readInt32LE(pos);
        pos += 4;

        this.originalHeight = buffer.readInt32LE(pos);
        pos += 4;

        this.originalWidth = buffer.readInt32LE(pos);
        pos += 4;

        this.usesAlpha = buffer.readInt8(pos);
        pos += 1;

        this.aleardyCompressed = buffer.readInt8(pos);
        pos += 1;

        // reservedFlags : unsigned char
        pos += 2;

        this.mipmapCount = buffer.readInt32LE(pos);
        pos += 4;

        // reserved : int[16]
        pos += 64;
        return pos;
    }
}

class RTTEXMipHeader {
    constructor() {
        this.height;
        this.width;
        this.dataSize;
        this.mipLevel;
        this.reversed;
    }

    serialize(buffer, pos = 0) {
        this.height = buffer.readInt32LE(pos);
        pos += 4;

        this.width = buffer.readInt32LE(pos);
        pos += 4;

        this.dataSize = buffer.readInt32LE(pos);
        pos += 4;

        this.mipLevel = buffer.readInt32LE(pos);
        pos += 4;

        // reversed : int[2]
        pos += 8;
        return pos;
    }
}

class RTTEX {
    constructor(buffer, pos = 0) {
        this.rttexHeader = new RTTEXHeader();
        this.rtpackHeader = new RTPackHeader();
        this.buffer = buffer;

        if (this.buffer.subarray(pos, 6).toString() == "RTPACK") {
            let temp_pos = this.rtpackHeader.serialize(this.buffer, pos);
            this.buffer = zlib.inflateSync(this.buffer.subarray(temp_pos, this.buffer.length));
        }

        this.pos = this.rttexHeader.serialize(this.buffer, pos);
    }

    async rawData(flipVertical = false) {
        if (this.rttexHeader.format != 5121) {
            return null;
        }

        let posBefore = this.pos;
        for (let i = 0; i < this.rttexHeader.mipmapCount; i++) {
            let mipHeader = new RTTEXMipHeader();
            this.pos = mipHeader.serialize(this.buffer, this.pos);
            let mipData = this.buffer.subarray(this.pos, this.pos + mipHeader.dataSize);

            this.pos = posBefore;
            
            if (flipVertical) {
                return new Promise(resolve => {
                    new jimp(mipHeader.width, mipHeader.height, (err, image) => {
                        if (err) throw err;
                        
                        image.bitmap.data.set(mipData);
                        image.flip(false, true);
                        resolve(image.bitmap.data);
                    });
                });
            }
        
            return mipData;
        }

        return null;
    }

    async write(path, flipVertical = true) {
        return new Promise(async (resolve) => {
            new jimp(this.rttexHeader.width, this.rttexHeader.height, async (err, image) => {
                if (err) {
                    // throw err;
                    resolve(false);
                }

                let ret = await this.rawData();
                image.bitmap.data.set(ret);
                image.flip(false, flipVertical);
                image.write(path);
                resolve(true);
            });
        });
    }
}

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question("Enter file path: ", async (answer) => {
        let data = fs.readFileSync(path.join(__dirname, answer), "binary");
        let buffer = Buffer.from(data, "binary");
    
        let rttex = new RTTEX(buffer);
        let ret = await rttex.write("./output.png");
    
        if (!ret) {
            console.log("Failed to convert RTTEX to image.");
        }
    
        console.log("Done."); 
    });
}

main();
