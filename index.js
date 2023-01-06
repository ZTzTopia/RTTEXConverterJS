const fs = require("node:fs");
const readline = require('node:readline');
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");

const C_RTFILE_PACKAGE_LATEST_VERSION = 0;
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
        pos = buffer.write("_".repeat(12), pos);
        buffer.write("ztz", pos);
        return Buffer.concat([ this.rtFileHeader.serialize(), buffer ]);
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
        const buffer = Buffer.alloc(92);
        let pos = buffer.writeInt32LE(this.height);
        pos = buffer.writeInt32LE(this.width, pos);
        pos = buffer.writeInt32LE(this.format, pos);
        pos = buffer.writeInt32LE(this.originalHeight, pos);
        pos = buffer.writeInt32LE(this.originalWidth, pos);
        pos = buffer.writeInt8(this.usesAlpha, pos);
        pos = buffer.writeInt8(this.aleardyCompressed, pos);
        pos = buffer.writeInt16LE(this.reversedFlags, pos);
        pos = buffer.writeInt32LE(this.mipmapCount, pos);
        pos = buffer.write("_".repeat(61), pos);
        buffer.write("ztz", pos);
        return Buffer.concat([ this.rtFileHeader.serialize(), buffer ]);
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
        pos = buffer.write("_".repeat(5), pos);
        buffer.write("ztz", pos);
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

            if (this.rtpackHeader.compressionType == eCompressionType_C_COMPRESSION_NONE) {
                this.buffer = this.buffer.subarray(tempPos, this.buffer.length);
            } else if (this.rtpackHeader.compressionType == eCompressionType_C_COMPRESSION_ZLIB) {
                this.buffer = zlib.inflateSync(this.buffer.subarray(tempPos, this.buffer.length));
            }
        }

        if (this.buffer.subarray(pos, C_RTFILE_PACKAGE_HEADER_BYTE_SIZE).toString() == C_RTFILE_TEXTURE_HEADER) {
            this.pos = this.rttexHeader.deserialize(this.buffer, pos);
        }
    }

    async rawData() {
        if (this.rttexHeader.format != 5121 && this.rttexHeader.format != RT_FORMAT_EMBEDDED_FILE) {
            console.log("this.rttexHeader.format != 5121 && this.rttexHeader.format != RT_FORMAT_EMBEDDED_FILE");
            return null;
        }

        if (this.rttexHeader.rtFileHeader.version > C_RTFILE_PACKAGE_LATEST_VERSION) {
            console.log("this.rttexHeader.rtFileHeader.version > 0");
            return null;
        }

        let posBefore = this.pos;
        for (let i = 0; i < this.rttexHeader.mipmapCount; i++) {
            let mipHeader = new RTTEXMipHeader();
            this.pos = mipHeader.deserialize(this.buffer, this.pos);
            let mipData = this.buffer.subarray(this.pos, this.pos + mipHeader.dataSize);

            this.pos = posBefore;

            if (mipData == null) {
                console.log("mipData == null");
                return null;
            }

            return mipData;
        }
    }

    async write(path, flipVertical = true) {
        return new Promise(async (resolve) => {
            let rawData = await this.rawData();
            if (rawData == null) {
                resolve(false);
            }

            sharp(rawData, {
                raw: {
                    width: this.rttexHeader.width,
                    height: this.rttexHeader.height,
                    channels: this.rttexHeader.usesAlpha ? 4 : 3,
                },
            })
            .flip(flipVertical)
            .toFile(path, (err, info) => {
                if (err) {
                    console.log(err);
                    resolve(false);
                }

                console.log(info);
                resolve(true);
            });
        });
    }
}

class ImageToRTFile {
    constructor(path) {
        this.buffer = fs.readFileSync(path);
    }

    async getImageSize() {
        let image = await sharp(this.buffer);
        let metadata = await image.metadata();
        return { 
            width: metadata.width, 
            height: metadata.height 
        };
    }

    async getImageLowestOf2Size() {
        const getLowestPowerOf2 = (n) => {
            let lowest = 1;
            while (lowest < n) {
                lowest <<= 1;
            }
            
            return lowest;
        }

        const { width, height } = await this.getImageSize();
        return { 
            width: getLowestPowerOf2(width), 
            height: getLowestPowerOf2(height)
        };
    }

    async rawData() {
        const imageSize = await this.getImageSize();
        const imageLowestOf2Size = await this.getImageLowestOf2Size();

        const { data, info } = await sharp(this.buffer)
            .flip(true)
            .ensureAlpha()
            .extend({ 
                top: imageLowestOf2Size.height - imageSize.height,
                bottom: 0, 
                left: 0, 
                right: imageLowestOf2Size.width - imageSize.width, 
                background: { 
                    r: 0, 
                    g: 0, 
                    b: 0, 
                    alpha: 0 
                }
            })
            .raw()
            .toBuffer({ resolveWithObject: true });
        const bitmap = {
            data,
            width: info.width,
            height: info.height,
        };

        console.log(info);
        return bitmap;
    }

    async write(path) {
        const imageSize = await this.getImageSize();
        const imageLowestOf2Size = await this.getImageLowestOf2Size();
        const rawData = await this.rawData();

        const rtFileHeader = new RTFileHeader();
        rtFileHeader.fileTypeId = C_RTFILE_TEXTURE_HEADER;
        rtFileHeader.version = C_RTFILE_PACKAGE_LATEST_VERSION;
        rtFileHeader.reversed = 0;

        const rttexHeader = new RTTEXHeader();
        rttexHeader.rtFileHeader = rtFileHeader;
        rttexHeader.height = imageLowestOf2Size.height;
        rttexHeader.width = imageLowestOf2Size.width;
        rttexHeader.format = 5121;
        rttexHeader.originalHeight = imageSize.height;
        rttexHeader.originalWidth = imageSize.width;
        rttexHeader.usesAlpha = 1;
        rttexHeader.aleardyCompressed = 0;
        rttexHeader.reversedFlags = 0;
        rttexHeader.mipmapCount = 1;
        rttexHeader.reversed = 1;

        const rttexMipHeader = new RTTEXMipHeader();
        rttexMipHeader.height = imageLowestOf2Size.height;
        rttexMipHeader.width = imageLowestOf2Size.width;
        rttexMipHeader.dataSize = rawData.data.length;
        rttexMipHeader.mipLevel = 0;
        rttexMipHeader.reversed = 0;

        const header = Buffer.concat([ rttexHeader.serialize(), rttexMipHeader.serialize() ]);
        const data = Buffer.concat([ header, rawData.data ]);
        const deflated = await zlib.deflateSync(data);

        rtFileHeader.fileTypeId = C_RTFILE_PACKAGE_HEADER;

        const rtPackHeader = new RTPackHeader();
        rtPackHeader.rtFileHeader = rtFileHeader;
        rtPackHeader.compressedSize = deflated.length;
        rtPackHeader.decompressedSize = data.length;
        rtPackHeader.compressionType = eCompressionType_C_COMPRESSION_ZLIB;

        let theData = Buffer.concat([ rtPackHeader.serialize(), deflated ]);
        fs.writeFileSync(path, theData);

        const hashString = (buffer) => {
            let hash = 0x55555555;
            if (buffer) {
                for (let i = 0; i < buffer.length; i++) {
                    hash = (hash >>> 27) + (hash << 5) + buffer[i];
                }
            }
        
            return hash;
        };

        console.log(`Hash: ${hashString(theData)}`);
        return true;
    }
}

(async () => {
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
            } else {
                console.log("Option not valid.");
                return;
            }
        
            console.log("Done."); 
        });
    });
})();
