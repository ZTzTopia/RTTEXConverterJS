const fs = require("fs");
const path = require("path");
const jimp = require("jimp");

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

        pos += 1;
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
        this.rttexHeader;
        this.mipHeaders = [];
        this.mipDatas = [];
        
        this.rttexHeader = new RTTEXHeader();
        pos = this.rttexHeader.serialize(buffer, pos);
        
        for (let i = 0; i < this.rttexHeader.mipmapCount; i++) {
            let mipHeader = new RTTEXMipHeader();
            pos = mipHeader.serialize(buffer, pos);
            this.mipHeaders.push(mipHeader);

            let mipData = buffer.subarray(pos, pos + mipHeader.dataSize);
            this.mipDatas.push(mipData);

            // TODO: Handle mipmap data
            break;
        }
    }

    toRawData(vertical = true) {
        if (this.mipDatas.length == 0) {
            return null;
        }

        if (vertical) {
            for (let i = 0; i < this.mipHeaders[0].height / 2; i++) {
                for (let j = 0; j < this.mipHeaders[0].width; j++) {
                    let temp = this.mipDatas[0][i * this.mipHeaders[0].width + j];
                    this.mipDatas[0][i * this.mipHeaders[0].width + j] = 
                        this.mipDatas[0][(this.mipHeaders[0].height - i - 1) * this.mipHeaders[0].width + j];
                    this.mipDatas[0][(this.mipHeaders[0].height - i - 1) * this.mipHeaders[0].width + j] = temp;
                }
            }
        }

        return this.mipDatas[0];
    }

    toImage(vertical = true) {
        if (this.mipDatas.length == 0) {
            return false;
        }

        const jimp_ = new jimp(this.mipHeaders[0].width, this.mipHeaders[0].height, (err, image) => {
            let buffer = image.bitmap.data
            for (let i = 0; i < this.mipHeaders[0].dataSize; i++) {
                buffer[i + 0] = this.mipDatas[0][i + 0];
                buffer[i + 1] = this.mipDatas[0][i + 1];
                buffer[i + 2] = this.mipDatas[0][i + 2];
                buffer[i + 3] = this.mipDatas[0][i + 3];
            }
        
            image.flip(false, vertical);
            image.write("output.png");
        });

        return true;
    }
}

function main() {
    let data = fs.readFileSync(path.join(__dirname, "output.rttex"), "binary");
    let buffer = Buffer.from(data, "binary");

    let rttex = new RTTEX(buffer);
    if (!rttex.toImage()) {
        console.log("Failed to convert RTTEX to image.");
    }

    console.log("Done.");
}

main();
