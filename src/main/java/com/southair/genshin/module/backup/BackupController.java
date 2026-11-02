package com.southair.genshin.module.backup;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import com.southair.genshin.security.UserContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 数据备份接口：导出 JSON 文件 / 导入 JSON 备份。
 */
@RestController
@RequestMapping("/api/backup")
public class BackupController {

    private static final DateTimeFormatter FILE_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final BackupService backupService;
    private final ObjectMapper objectMapper;

    public BackupController(BackupService backupService, ObjectMapper objectMapper) {
        this.backupService = backupService;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue = "genshin") String game) {
        BackupVO backup = backupService.export(UserContext.require(), game);
        backup.setChecksumApp("southair-web");
        backup.setChecksum(BackupChecksum.compute(objectMapper, backup));
        byte[] content;
        try {
            content = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(backup);
        } catch (JsonProcessingException e) {
            throw new BusinessException(500, "导出失败：" + e.getOriginalMessage());
        }

        String filename = "southair-" + GameType.normalize(game) + "-backup-"
                + LocalDateTime.now().format(FILE_TIME) + ".json";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8))
                .body(content);
    }

    /**
     * 全量导出：一次把两个游戏的资源与抽卡记录打包成一个 JSON，用于换设备或整体备份。
     */
    @GetMapping("/export-all")
    public ResponseEntity<byte[]> exportAll() {
        FullBackupVO backup = backupService.exportAll(UserContext.require());
        for (BackupVO game : backup.getGames().values()) {
            game.setChecksumApp("southair-web");
            game.setChecksum(BackupChecksum.compute(objectMapper, game));
        }
        backup.setChecksumApp("southair-web");
        backup.setChecksum(BackupChecksum.compute(objectMapper, backup));
        byte[] content;
        try {
            content = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(backup);
        } catch (JsonProcessingException e) {
            throw new BusinessException(500, "导出失败：" + e.getOriginalMessage());
        }

        String filename = "southair-all-backup-"
                + LocalDateTime.now().format(FILE_TIME) + ".json";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8))
                .body(content);
    }

    /**
     * 全量导入：按文件内的游戏分别写入。
     *
     * @param mode merge（默认，保留现有数据并跳过重复） / replace（清空后全量导入）
     */
    @PostMapping("/import-all")
    public R<ImportResultVO> importAll(@RequestBody FullBackupVO backup,
                                       @RequestParam(defaultValue = "merge") String mode) {
        // 导入前先校验快照完整性；旧备份没有 checksum 时跳过
        BackupChecksum.verify(objectMapper, backup, backup.getChecksum(), backup.getChecksumApp());
        if (backup.getGames() != null) {
            for (BackupVO game : backup.getGames().values()) {
                if (game != null) {
                    BackupChecksum.verify(objectMapper, game, game.getChecksum(), game.getChecksumApp());
                }
            }
        }
        return R.ok(backupService.importAll(UserContext.require(), backup, mode));
    }

    /**
     * @param mode merge（默认，保留现有数据并跳过重复） / replace（清空后全量导入）
     */
    @PostMapping("/import")
    public R<ImportResultVO> importData(@RequestBody BackupVO backup,
                                        @RequestParam(defaultValue = "genshin") String game,
                                        @RequestParam(defaultValue = "merge") String mode) {
        BackupChecksum.verify(objectMapper, backup, backup.getChecksum(), backup.getChecksumApp());
        return R.ok(backupService.importData(UserContext.require(), game, backup, mode));
    }
}
