const fs = require("node:fs");
const readline = require('node:readline');
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");

const C_RTFILE_PACKAGE_LATEST_VERSION = 1;
const C_RTFILE_PACKAGE_HEADER = "RTPACK";
const C_RTFILE_PACKAGE_HEADER_BYTE_SIZE = 6;

class RTFileHeader {
    constructor() {
        this.fileTypeId;
        this.version;
        this.reversed;
    }

    deserialize(buffer, pos = 0) {
        this.fileTypeId = buffer.subarray(pos, 6).toString();
        pos += 6;

        this.version = buffer.readInt8(pos);
        pos += 1;

        // reverse : uint8_t
        pos += 1;
        return pos;
    }

    serialize() {
        const buffer = Buffer.alloc(8);
        let pos = buffer.write(this.fileTypeId);
        pos = buffer.writeInt8(this.version, pos);
        buffer.writeInt8(this.reversed, pos);
        return buffer;
    }
}

// enum eCompressionType {
//     C_COMPRESSION_NONE = 0,
//     C_COMPRESSION_ZLIB = 1
// }
const eCompressionType_C_COMPRESSION_NONE = 0;
const eCompressionType_C_COMPRESSION_ZLIB = 1;

class RTPackHeader {
    constructor() {
        this.rtFileHeader;
        this.compressedSize;
        this.decompressedSize;
        this.compressionType;
        this.reversed;
    }

    deserialize(buffer, pos = 0) {
        this.rtFileHeader = new RTFileHeader();
        pos = this.rtFileHeader.deserialize(buffer, pos);

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

    serialize() {
        const buffer = Buffer.alloc(24);
        let pos = buffer.writeInt32LE(this.compressedSize);
        pos = buffer.writeInt32LE(this.decompressedSize, pos);
        pos = buffer.writeInt8(this.compressionType, pos);
        buffer.write("z".repeat(15), pos);

        return Buffer.concat([this.rtFileHeader.serialize(), buffer]);
    }
}

const RT_FORMAT_EMBEDDED_FILE = 20000000;
const C_RTFILE_TEXTURE_HEADER = "RTTXTR";

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

    deserialize(buffer, pos = 0) {
        this.rtFileHeader = new RTFileHeader();
        pos = this.rtFileHeader.deserialize(buffer, pos);

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

    serialize() {
        const buffer = Buffer.alloc(28 + 64);
        let pos = buffer.writeInt32LE(this.height);
        pos = buffer.writeInt32LE(this.width, pos);
        pos = buffer.writeInt32LE(this.format, pos);
        pos = buffer.writeInt32LE(this.originalHeight, pos);
        pos = buffer.writeInt32LE(this.originalWidth, pos);
        pos = buffer.writeInt8(this.usesAlpha, pos);
        pos = buffer.writeInt8(this.aleardyCompressed, pos);
        pos = buffer.writeInt16LE(this.reversedFlags, pos);
        pos = buffer.writeInt32LE(this.mipmapCount, pos);
        buffer.write("ztz_".repeat(16), pos);

        return Buffer.concat([this.rtFileHeader.serialize(), buffer]);
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

    deserialize(buffer, pos = 0) {
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

    serialize() {
        const buffer = Buffer.alloc(28);
        let pos = buffer.writeInt32LE(this.height);
        pos = buffer.writeInt32LE(this.width, pos);
        pos = buffer.writeInt32LE(this.dataSize, pos);
        pos = buffer.writeInt32LE(this.mipLevel, pos);
        pos = buffer.writeInt32LE(this.reversed, pos);
        buffer.writeInt32LE(this.reversed, pos);
        return buffer;
    }
}

class RTFileToImage {
    constructor(path, pos = 0) {
        this.rttexHeader = new RTTEXHeader();
        this.rtpackHeader = new RTPackHeader();
        this.buffer = fs.readFileSync(path);
        this.pos = 0;

        if (this.buffer.subarray(pos, C_RTFILE_PACKAGE_HEADER_BYTE_SIZE).toString() == C_RTFILE_PACKAGE_HEADER) {
            const tempPos = this.rtpackHeader.deserialize(this.buffer, pos);
            if (this.rtpackHeader.compressionType == eCompressionType_C_COMPRESSION_ZLIB) {
                this.buffer = zlib.inflateSync(this.buffer.subarray(tempPos, this.buffer.length));
            }
        }

        if (this.buffer.subarray(pos, C_RTFILE_PACKAGE_HEADER_BYTE_SIZE).toString() == C_RTFILE_TEXTURE_HEADER) {
            this.pos = this.rttexHeader.deserialize(this.buffer, pos);
        }
    }

    async rawData() {
        return new Promise(resolve => {
            if (this.rttexHeader.format != 5121) {
                resolve(null);
            }

            if (this.rttexHeader.rtFileHeader.version >= C_RTFILE_PACKAGE_LATEST_VERSION) {
                resolve(null);
            }

            let posBefore = this.pos;
            for (let i = 0; i < this.rttexHeader.mipmapCount; i++) {
                let mipHeader = new RTTEXMipHeader();
                this.pos = mipHeader.deserialize(this.buffer, this.pos);
                let mipData = this.buffer.subarray(this.pos, this.pos + mipHeader.dataSize);

                this.pos = posBefore;
                
                resolve(mipData);
            }
        });
    }

    async write(path, flipVertical = true) {
        return new Promise(async (resolve) => {
            let rawData = await this.rawData();
            if (rawData == null) {
                console.error("RTFile raw data is null!");
            }

            sharp(rawData, {
                raw: {
                    width: this.rttexHeader.width,
                    height: this.rttexHeader.height,
                    channels: 4,
                },
            })
            .flip(flipVertical)
            .toFile(path, (err, info) => {
                if (err) {
                    resolve(false);
                }

                resolve(true);
            });
        });
    }
}

class ImageToRTFile {
    bitmap;
    path;

    constructor(path) {
        this.bitmap = {};
        this.path = path;
    }

    async wwkwkwkk() {
        const { data, info } = await sharp(this.path)
            .flip(true)
            .flatten({ background: "#ffffff" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const bitmap = {
            data,
            width: info.width,
            height: info.height,
        };

        this.bitmap = bitmap;
    }

    async write(path) {
        await this.wwkwkwkk();
        return new Promise(async (resolve, reject) => {
            const rtFileHeader = new RTFileHeader();
            rtFileHeader.fileTypeId = C_RTFILE_TEXTURE_HEADER;
            rtFileHeader.version = C_RTFILE_PACKAGE_LATEST_VERSION;
            rtFileHeader.reversed = 0;

            const rttexHeader = new RTTEXHeader();
            rttexHeader.rtFileHeader = rtFileHeader;
            rttexHeader.height = this.bitmap.height;
            rttexHeader.width = this.bitmap.width;
            rttexHeader.format = 5121;
            rttexHeader.originalHeight = this.bitmap.height;
            rttexHeader.originalWidth = this.bitmap.width;
            rttexHeader.usesAlpha = 1;
            rttexHeader.aleardyCompressed = 0;
            rttexHeader.reversedFlags = 0;
            rttexHeader.mipmapCount = 1;
            rttexHeader.reversed = 1;

            const rttexMipHeader = new RTTEXMipHeader();
            rttexMipHeader.height = this.bitmap.height;
            rttexMipHeader.width = this.bitmap.width;
            rttexMipHeader.dataSize = this.bitmap.data.length;
            rttexMipHeader.mipLevel = 0;
            rttexMipHeader.reversed = 0;

            const rtFileHeader_ = new RTFileHeader();
            rtFileHeader_.fileTypeId = C_RTFILE_PACKAGE_HEADER;
            rtFileHeader_.version = C_RTFILE_PACKAGE_LATEST_VERSION;
            rtFileHeader_.reversed = 0;

            const concat1 = Buffer.concat([rttexHeader.serialize(), rttexMipHeader.serialize()]);
            const concat2 = Buffer.concat([concat1, this.bitmap.data]);
            const deflated = await zlib.deflateSync(concat2);

            console.log(deflated.length);
            console.log(concat2.length);

            const rtPackHeader = new RTPackHeader();
            rtPackHeader.rtFileHeader = rtFileHeader_;
            rtPackHeader.compressedSize = deflated.length;
            rtPackHeader.decompressedSize = concat2.length;
            rtPackHeader.type = eCompressionType_C_COMPRESSION_ZLIB;

            fs.writeFileSync(path, rtPackHeader.serialize());
            fs.appendFileSync(path, deflated);

            resolve(true);
        });
    }
}

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question("Enter converter type [1: To Image, 2: To RTTEX]: ", async (type) => {
        rl.question("Enter file path: ", async (file) => {
            if (type == 1) {
                let image = new RTFileToImage(path.join(__dirname, file));
                let ret = await image.write("./output.png");
            
                if (!ret) {
                    console.log("Failed to convert RTTEX to image.");
                }
            } else if (type == 2) {
                let rttex = new ImageToRTFile(path.join(__dirname, file));
                let ret = await rttex.write("./output.rttex");
            
                if (!ret) {
                    console.log("Failed to convert image to RTTEX.");
                }
            }
        
            console.log("Done."); 
        });
    });
}

main();
