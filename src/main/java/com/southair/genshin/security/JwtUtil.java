package com.southair.genshin.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * JWT 工具：签发与解析访问令牌。
 */
@Component
public class JwtUtil {

    @Value("${app.jwt.secret}")
    private String secret;

    @Value("${app.jwt.expire-hours:72}")
    private long expireHours;

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
