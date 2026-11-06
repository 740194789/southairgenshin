package com.southair.genshin.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * JWT 工具：签发与解析访问令牌。
 */
@Component
public class JwtUtil {

    @Value("${app.jwt.secret:}")
    private String secret;

    @Value("${app.jwt.expire-hours:72}")
    private long expireHours;

    /**
     * 密钥必须由部署方提供（环境变量 SA_JWT_SECRET），缺失或过短时直接拒绝启动，
     * 避免继续使用仓库里出现过的默认值。
     */
    @PostConstruct
    void validateSecret() {
        if (secret == null || secret.trim().isEmpty()) {
            throw new IllegalStateException(
                    "未配置 JWT 密钥：请设置环境变量 SA_JWT_SECRET（至少 32 个字符的随机串）后再启动");
        }
        if (secret.trim().length() < 32) {
            throw new IllegalStateException(
                    "JWT 密钥太短：SA_JWT_SECRET 至少需要 32 个字符，建议使用 openssl rand -base64 48 生成");
        }
    }

    private byte[] key() {
        return secret.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 签发 token。
     */
    public String generate(Long userId, String username) {
        Date now = new Date();
        Date expiration = new Date(now.getTime() + expireHours * 3600_000L);
        return Jwts.builder()
                .setSubject(String.valueOf(userId))
                .claim("username", username)
                .setIssuedAt(now)
                .setExpiration(expiration)
                .signWith(SignatureAlgorithm.HS256, key())
                .compact();
    }

    /**
     * 解析 token 中的用户 ID，失效或非法时抛出异常。
     */
    public Long parseUserId(String token) {
        Claims claims = Jwts.parser()
                .setSigningKey(key())
                .parseClaimsJws(token)
                .getBody();
        return Long.valueOf(claims.getSubject());
    }

    public long getExpireHours() {
        return expireHours;
    }
}
