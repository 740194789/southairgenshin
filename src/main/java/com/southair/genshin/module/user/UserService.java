package com.southair.genshin.module.user;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.module.user.dto.AuthResponse;
import com.southair.genshin.module.user.dto.ChangePasswordRequest;
import com.southair.genshin.module.user.dto.LoginRequest;
import com.southair.genshin.module.user.dto.RegisterRequest;
import com.southair.genshin.module.user.dto.ResetPasswordRequest;
import com.southair.genshin.module.user.dto.UserVO;
import com.southair.genshin.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.security.SecureRandom;
import java.util.Locale;

@Service
public class UserService {

    /** 恢复码字符集：去掉 0/O/1/I 这类容易抄错的字符 */
    private static final String RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int RECOVERY_LENGTH = 16;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    /**
     * 注册并直接返回登录凭证。
     */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String username = request.getUsername().trim();
        if (userRepository.existsByUsername(username)) {
            throw new BusinessException("该账号已被注册");
        }

        User user = new User();
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNickname(StringUtils.hasText(request.getNickname())
                ? request.getNickname().trim()
                : username);
        user.setRole("USER");
        String recoveryCode = newRecoveryCode();
        user.setRecoveryCode(passwordEncoder.encode(normalizeRecoveryCode(recoveryCode)));
        userRepository.save(user);

        AuthResponse response = buildAuthResponse(user);
        // 明文恢复码只在注册时返回一次，前端需要提示用户抄写保存
        response.setRecoveryCode(recoveryCode);
        return response;
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByUsername(request.getUsername().trim())
                .orElseThrow(() -> new BusinessException("账号或密码错误"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new BusinessException("账号或密码错误");
        }
        return buildAuthResponse(user);
    }

    @Transactional(readOnly = true)
    public UserVO getProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        return UserVO.from(user);
    }

    /**
     * 只修改用户名（昵称），登录账号与密码保持不变。
     */
    @Transactional
    public UserVO updateNickname(Long userId, String nickname) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        String name = nickname == null ? "" : nickname.trim();
        if (!StringUtils.hasText(name)) {
            throw new BusinessException("用户名不能为空");
        }
        user.setNickname(name.length() > 32 ? name.substring(0, 32) : name);
        userRepository.save(user);
        return UserVO.from(user);
    }

    /** 已登录用户修改密码：必须提供当前密码，防止会话被盗后直接改密。 */
    @Transactional
    public void changePassword(Long userId, ChangePasswordRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPassword())) {
            throw new BusinessException("当前密码不正确");
        }
        if (request.getCurrentPassword().equals(request.getNewPassword())) {
            throw new BusinessException("新密码不能与当前密码相同");
        }
        user.setPassword(passwordEncoder.encode(request.getNewPassword()));
        userRepository.save(user);
    }

    /** 忘记密码：账号 + 恢复码重置密码，成功后直接返回新的登录凭证。 */
    @Transactional
    public AuthResponse resetPassword(ResetPasswordRequest request) {
        User user = userRepository.findByUsername(request.getUsername().trim())
                .orElseThrow(() -> new BusinessException("账号或恢复码错误"));
        if (!StringUtils.hasText(user.getRecoveryCode())) {
            throw new BusinessException("该账号还没有恢复码，请登录后在「设置 · 账号安全」里生成");
        }
        String code = normalizeRecoveryCode(request.getRecoveryCode());
        if (!code.isEmpty() && passwordEncoder.matches(code, user.getRecoveryCode())) {
            user.setPassword(passwordEncoder.encode(request.getNewPassword()));
            userRepository.save(user);
            return buildAuthResponse(user);
        }
        throw new BusinessException("账号或恢复码错误");
    }

    /** 生成 / 重新生成恢复码，返回明文（只在这一次返回）。 */
    @Transactional
    public String regenerateRecoveryCode(Long userId, String currentPassword) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        if (!passwordEncoder.matches(currentPassword, user.getPassword())) {
            throw new BusinessException("当前密码不正确");
        }
        String code = newRecoveryCode();
        user.setRecoveryCode(passwordEncoder.encode(normalizeRecoveryCode(code)));
        userRepository.save(user);
        return code;
    }

    /** 恢复码：16 位、每 4 位一组，只用不易混淆的大写字母和数字。 */
    private static String newRecoveryCode() {
        StringBuilder builder = new StringBuilder(RECOVERY_LENGTH + 3);
        for (int i = 0; i < RECOVERY_LENGTH; i++) {
            if (i > 0 && i % 4 == 0) {
                builder.append('-');
            }
            builder.append(RECOVERY_ALPHABET.charAt(RANDOM.nextInt(RECOVERY_ALPHABET.length())));
        }
        return builder.toString();
    }

    /** 比较时忽略大小写、空格和横杠，用户抄写时不用在意格式。 */
    private static String normalizeRecoveryCode(String raw) {
        return raw == null ? "" : raw.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.ROOT);
    }

    private AuthResponse buildAuthResponse(User user) {
        String token = jwtUtil.generate(user.getId(), user.getUsername());
        return new AuthResponse(token, UserVO.from(user));
    }
}
