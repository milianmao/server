import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Kuwo Music DES加密算法实现类
 * 用于处理音乐下载过程中的数据加密和解密操作
 */
public class KwDES {
    // 自定义 Long 类型的位运算方法
    private static long not(long n) {
        return ~n;
    }

    private static long or(long a, long b) {
        return a | b;
    }

    private static long and(long a, long b) {
        return a & b;
    }

    private static long xor(long a, long b) {
        return a ^ b;
    }

    private static long shiftLeft(long n, int bits) {
        return n << bits;
    }

    private static long shiftRight(long n, int bits) {
        return n >> bits;
    }

    // 预定义的置换表 - DES算法中使用的各种置换矩阵

    // 扩展置换表E，将32位扩展为48位
    private static final int[] arrayE = {
            31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1,
            7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1,
            15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1,
            23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1
    };

    // 初始置换表IP
    private static final int[] arrayIP = {
            57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
            61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
            56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2,
            60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6
    };

    // 初始逆置换表IP-1
    private static final int[] arrayIP_1 = {
            39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30,
            37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
            35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26,
            33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24
    };

    // 左移位数表，用于密钥生成过程中的循环左移
    private static final int[] arrayLs = {1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1};
    // 左移掩码表，用于控制左移操作
    private static final long[] arrayLsMask = {0, 0x100001L, 0x300003L};
    // 位掩码数组，用于获取特定位的值
    private static final long[] arrayMask = new long[64];

    // 置换函数P表，用于S盒输出后的置换
    private static final int[] arrayP = {
            15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
            1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24
    };

    // 密钥置换表PC-1，用于从64位密钥中选取56位
    private static final int[] arrayPC_1 = {
            56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1,
            58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38,
            30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36,
            28, 20, 12, 4, 27, 19, 11, 3
    };

    // 密钥置换表PC-2，用于从56位密钥中选取48位生成子密钥
    private static final int[] arrayPC_2 = {
            13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1,
            22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1,
            40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1,
            43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1
    };

    // S盒替换表，DES算法中的非线性替换组件
    private static final int[][] matrixNSBox = {
            {
                    14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5,
                    4, 1, 10, 12, 15, 6, 9, 10, 1, 8, 12, 7, 8, 11, 7, 0,
                    0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6,
                    15, 12, 6, 11, 2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13
            },
            {
                    15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2,
                    1, 14, 7, 8, 11, 4, 0, 3, 14, 11, 13, 6, 4, 1, 10, 15,
                    3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14,
                    13, 8, 0, 6, 2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9
            },
            {
                    10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14,
                    0, 6, 13, 1, 3, 15, 4, 10, 14, 9, 7, 12, 5, 0, 8, 7,
                    13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2,
                    7, 10, 8, 15, 4, 9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12
            },
            {
                    7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8,
                    13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5, 14, 10, 13, 15, 4,
                    13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2,
                    8, 15, 7, 4, 15, 1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14
            },
            {
                    2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0,
                    12, 2, 5, 9, 10, 13, 0, 3, 1, 11, 15, 5, 6, 8, 9, 14,
                    14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5,
                    11, 8, 0, 15, 7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3
            },
            {
                    12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11,
                    1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4, 10, 8, 3, 11, 6,
                    10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8,
                    15, 3, 1, 14, 12, 5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13
            },
            {
                    4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9,
                    11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7, 8, 13, 14, 1, 2,
                    13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3,
                    0, 11, 3, 5, 9, 4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12
            },
            {
                    13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5,
                    2, 11, 9, 6, 15, 12, 0, 3, 4, 1, 14, 13, 1, 2, 7, 8,
                    1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6,
                    15, 1, 5, 12, 3, 10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11
            }
    };

    // 静态初始化 arrayMask，为每个位创建掩码
    static {
        for (int i = 0; i < 63; i++) {
            arrayMask[i] = 1L << i;
        }
        arrayMask[63] = -9223372036854775808L; // 2^63 的负数表示
    }

    /**
     * 位变换函数，根据给定的置换表重新排列输入值的位
     * @param arrInt 置换表数组
     * @param n 置换表长度
     * @param l 输入的长整型值
     * @return 经过位变换后的值
     */
    private static long bitTransform(int[] arrInt, int n, long l) {
        long l2 = 0;
        for (int i = 0; i < n; i++) {
            if (arrInt[i] < 0 || and(l, arrayMask[arrInt[i]]) == 0) {
                continue;
            }
            l2 = or(l2, arrayMask[i]);
        }
        return l2;
    }

    /**
     * DES64核心加密函数，执行64位数据块的DES加密/解密操作
     * @param longs 子密钥数组
     * @param l 输入的64位数据块
     * @return 加密/解密后的结果
     */
    private static long DES64(long[] longs, long l) {
        long[] pR = new long[8]; // 用于存储8个6位子块
        long[] pSource = {0, 0}; // 存储左右两部分数据

        // 初始置换
        long out = bitTransform(arrayIP, 64, l);
        // 分割为左右两部分
        pSource[0] = and(out, 0xFFFFFFFFL); // 低32位
        pSource[1] = shiftRight(and(out, -4294967296L), 32); // 高32位

        // 16轮Feistel网络
        for (int i = 0; i < 16; i++) {
            long SOut = 0;
            long R = pSource[1]; // 当前轮的右半部分

            // 扩展置换，将32位扩展到48位
            R = bitTransform(arrayE, 64, R);
            // 与子密钥异或
            R = xor(R, longs[i]);

            // 将48位分成8个6位的子块
            for (int j = 0; j < 8; j++) {
                pR[j] = and(shiftRight(R, j * 8), 255L);
            }

            // S盒替换，8个S盒每个将6位映射为4位
            for (int sbi = 7; sbi >= 0; sbi--) {
                SOut = shiftLeft(SOut, 4) | matrixNSBox[sbi][(int) pR[sbi]];
            }

            // P盒置换
            R = bitTransform(arrayP, 32, SOut);
            long L = pSource[0]; // 当前轮的左半部分
            // 交换左右部分（Feistel网络）
            pSource[0] = pSource[1];
            pSource[1] = xor(L, R);
        }

        // 最后一轮结束后，交换左右两部分
        long temp = pSource[0];
        pSource[0] = pSource[1];
        pSource[1] = temp;

        // 组合左右两部分
        out = or(shiftLeft(pSource[1], 32), and(pSource[0], 0xFFFFFFFFL));
        // 最终逆置换
        out = bitTransform(arrayIP_1, 64, out);
        return out;
    }

    /**
     * 生成子密钥数组
     * @param l 原始密钥
     * @param longs 用于存储生成的子密钥的数组
     * @param n 模式：0表示加密，1表示解密
     */
    private static void subKeys(long l, long[] longs, int n) {
        // 密钥初始置换PC-1
        long l2 = bitTransform(arrayPC_1, 56, l);
        // 生成16个子密钥
        for (int i = 0; i < 16; i++) {
            int ls = arrayLs[i]; // 左移位数
            long mask = arrayLsMask[ls]; // 左移掩码
            // 循环左移操作
            l2 = or(shiftLeft(and(l2, mask), 28 - ls), shiftRight(and(l2, not(mask)), ls));
            // 密钥置换PC-2，生成48位子密钥
            longs[i] = bitTransform(arrayPC_2, 64, l2);
        }

        // 解密模式下，子密钥需要逆序
        if (n == 1) {
            for (int j = 0; j < 8; j++) {
                long temp = longs[j];
                longs[j] = longs[15 - j];
                longs[15 - j] = temp;
            }
        }
    }

    /**
     * 核心加解密函数
     * @param msg 输入的消息字节数组
     * @param key 密钥字节数组
     * @param mode 模式：0表示加密，1表示解密
     * @return 加密或解密后的字节数组
     */
    private static byte[] crypt(byte[] msg, byte[] key, int mode) {
        // 处理密钥块，将8字节密钥转换为长整型
        long l = 0;
        for (int i = 0; i < 8; i++) {
            l = or(shiftLeft((key[i] & 0xFFL), i * 8), l);
        }

        int j = msg.length / 8; // 计算完整的8字节块数量
        // arrLong1 存放的是转换后的密钥块, 在解密时只需要把这个密钥块反转就行了
        long[] arrLong1 = new long[16];
        subKeys(l, arrLong1, mode);

        // arrLong2 存放的是前部分的明文
        long[] arrLong2 = new long[j];

        // 将输入消息转换为长整型数组
        for (int m = 0; m < j; m++) {
            for (int n = 0; n < 8; n++) {
                arrLong2[m] = or(shiftLeft((msg[n + m * 8] & 0xFFL), n * 8), arrLong2[m]);
            }
        }

        // 用于存放密文
        long[] arrLong3 = new long[(1 + 8 * (j + 1)) / 8];

        // 计算前部的数据块(除了最后一部分)
        for (int i1 = 0; i1 < j; i1++) {
            arrLong3[i1] = DES64(arrLong1, arrLong2[i1]);
        }

        // 处理不完整的最后一块
        byte[] arrByte1 = new byte[msg.length % 8];
        System.arraycopy(msg, j * 8, arrByte1, 0, arrByte1.length);
        long l2 = 0;

        for (int i1 = 0; i1 < arrByte1.length; i1++) {
            l2 = or(shiftLeft((arrByte1[i1] & 0xFFL), i1 * 8), l2);
        }

        // 计算多出的那一位(最后一位)
        if (arrByte1.length > 0 || mode == 0) {
            arrLong3[j] = DES64(arrLong1, l2); // 解密不需要
        }

        // 将密文转为字节型
        byte[] arrByte2 = new byte[8 * arrLong3.length];
        int i4 = 0;
        for (long l3 : arrLong3) {
            for (int i6 = 0; i6 < 8; i6++) {
                arrByte2[i4] = (byte) and(shiftRight(l3, i6 * 8), 255L);
                i4++;
            }
        }

        return arrByte2;
    }

    // 固定的密钥，用于加密和解密
    private static final byte[] SECRET_KEY = "ylzsxkwm".getBytes(StandardCharsets.UTF_8);

    /**
     * 提供给外部调用的加密方法
     * @param msg 需要加密的字节数组
     * @return 加密后的字节数组
     */
    public static byte[] encrypt(byte[] msg) {
        return crypt(msg, SECRET_KEY, 0);
    }

    /**
     * 提供给外部调用的解密方法
     * @param msg 需要解密的字节数组
     * @return 解密后的字节数组
     */
    public static byte[] decrypt(byte[] msg) {
        return crypt(msg, SECRET_KEY, 1);
    }

    /**
     * 加密查询字符串并进行Base64编码
     * @param query 原始查询字符串
     * @return 加密并Base64编码后的字符串
     */
    public static String encryptQuery(String query) {
        byte[] encrypted = encrypt(query.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(encrypted);
    }

    /**
     * 解密Base64编码的查询字符串
     * @param query 加密并Base64编码的查询字符串
     * @return 解密后的原始字符串
     */
    public static String decryptQuery(String query) {
        byte[] decoded = Base64.getDecoder().decode(query);
        byte[] decrypted = decrypt(decoded);
        return new String(decrypted, StandardCharsets.UTF_8).trim();
    }

    // 测试方法
    public static void main(String[] args) {
        String original = "test message";
        String encrypted = encryptQuery(original);
        String decrypted = decryptQuery(encrypted);
        System.out.println("Original: " + original);
        System.out.println("Encrypted: " + encrypted);
        System.out.println("Decrypted: " + decrypted);
    }
}