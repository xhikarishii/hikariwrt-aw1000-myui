package moe.hikarishii.hikariwrt;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * "Remember me": the saved sign-in is sealed with an AES-GCM key that lives in
 * the Android Keystore and never leaves it, so the preferences file only ever
 * holds ciphertext. The app is also excluded from backups (allowBackup=false),
 * and the key can't be copied off the phone either.
 */
final class Vault {
    private Vault() {}

    private static final String ALIAS = "hikariwrt-login";
    private static final String CIPHER = "AES/GCM/NoPadding";

    /** "iv:ciphertext", both base64. */
    static String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance(CIPHER);
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    /** What seal() was given; throws when it can't be opened (a new key, a damaged entry). */
    static String open(String sealed) throws Exception {
        int i = sealed.indexOf(':');
        if (i < 0) throw new IllegalArgumentException("not sealed");
        byte[] iv = Base64.decode(sealed.substring(0, i), Base64.NO_WRAP);
        byte[] ct = Base64.decode(sealed.substring(i + 1), Base64.NO_WRAP);
        Cipher c = Cipher.getInstance(CIPHER);
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(ct), StandardCharsets.UTF_8);
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        Key k = ks.getKey(ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }
}
