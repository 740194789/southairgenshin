package com.southair.genshin.module.wish;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.PageResult;
import com.southair.genshin.common.R;
import com.southair.genshin.module.wish.dto.CollectionItemVO;
import com.southair.genshin.module.wish.dto.GachaLinkRequest;
import com.southair.genshin.module.wish.dto.UigfParseResult;
import com.southair.genshin.module.wish.dto.WishBatchRequest;
import com.southair.genshin.module.wish.dto.WishImportResult;
import com.southair.genshin.module.wish.dto.WishRequest;
import com.southair.genshin.security.UserContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/wishes")
public class WishController {

    private static final DateTimeFormatter FILE_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final WishService wishService;
    private final ObjectMapper objectMapper;
    private final GachaLinkImporter gachaLinkImporter;
    private final UigfService uigfService;

    public WishController(WishService wishService, ObjectMapper objectMapper,
                          GachaLinkImporter gachaLinkImporter, UigfService uigfService) {
        this.wishService = wishService;
        this.objectMapper = objectMapper;
        this.gachaLinkImporter = gachaLinkImporter;
        this.uigfService = uigfService;
    }

    @GetMapping
    public R<PageResult<WishRecord>> list(@RequestParam(required = false) String pool,
                                          @RequestParam(required = false) Integer rarity,
                                          @RequestParam(required = false) String uid,
                                          @RequestParam(required = false) String keyword,
                                          @RequestParam(required = false) String start,
                                          @RequestParam(required = false) String end,
                                          @RequestParam(defaultValue = "genshin") String game,
                                          @RequestParam(defaultValue = "1") int page,
                                          @RequestParam(defaultValue = "10") int size) {
        return R.ok(wishService.page(UserContext.require(), game, pool, page, size, rarity,
                uid, keyword, parseStart(start), parseEnd(end)));
    }

    /** 当前账号出现过的 UID，用于抽卡页筛选。 */
    @GetMapping("/uids")
    public R<List<String>> uids(@RequestParam(defaultValue = "genshin") String game) {
        return R.ok(wishService.uids(UserContext.require(), game));
    }

    /** UID + 由 UID 推断的区服 + 记录数，用于抽卡页筛选展示。 */
    @GetMapping("/accounts")
    public R<List<java.util.Map<String, Object>>> accounts(
            @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(wishService.accounts(UserContext.require(), game));
    }

    /** 收藏图鉴：全部记录按名称 / 类型 / 星级聚合。 */
    @GetMapping("/collection")
    public R<List<CollectionItemVO>> collection(
            @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(wishService.collection(UserContext.require(), game));
    }

    @GetMapping("/{id}")
    public R<WishRecord> detail(@PathVariable Long id) {
        return R.ok(wishService.get(UserContext.require(), id));
    }

    @PostMapping
    public R<WishRecord> create(@Valid @RequestBody WishRequest request,
                                @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(wishService.create(UserContext.require(), game, request));
    }

    @PutMapping("/{id}")
    public R<WishRecord> update(@PathVariable Long id, @Valid @RequestBody WishRequest request) {
        return R.ok(wishService.update(UserContext.require(), id, request));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        wishService.delete(UserContext.require(), id);
        return R.ok();
    }

    /** 批量删除。 */
    @DeleteMapping("/batch")
    public R<Void> deleteBatch(@RequestBody List<Long> ids) {
        wishService.deleteBatch(UserContext.require(), ids);
        return R.ok();
    }

    /** 批量编辑已有记录。 */
    @PutMapping("/batch")
    public R<List<WishRecord>> updateBatch(@Valid @RequestBody WishBatchRequest request) {
        return R.ok(wishService.updateBatch(UserContext.require(), request));
    }

    /** 导出抽卡记录：format=csv（默认）或 json。 */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue = "genshin") String game,
                                         @RequestParam(defaultValue = "csv") String format) {
        List<WishRecord> records = wishService.exportAll(UserContext.require(), game);
        boolean json = "json".equalsIgnoreCase(format);
        byte[] content;
        MediaType mediaType;
        String extension;
        if (json) {
            try {
                content = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(records);
            } catch (Exception e) {
                throw new BusinessException(500, "导出失败：" + e.getMessage());
            }
            mediaType = new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8);
            extension = "json";
        } else {
            content = WishCsv.write(records).getBytes(StandardCharsets.UTF_8);
            mediaType = new MediaType("text", "csv", StandardCharsets.UTF_8);
            extension = "csv";
        }

        String gameLabel = GameType.normalize(game);
        String filename = "southair-" + gameLabel + "-wishes-"
                + LocalDateTime.now().format(FILE_TIME) + "." + extension;
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(mediaType)
                .body(content);
    }

    /**
     * 导入模板：CSV 为表头 + 一条三星示例行，JSON 为一条示例记录。
     * 三星物品不会被记录，所以示例行即使忘记删除也不会污染数据。
     */
    @GetMapping("/template")
    public ResponseEntity<byte[]> template(@RequestParam(defaultValue = "csv") String format) {
        WishRecord sample = new WishRecord();
        sample.setWishTime(LocalDateTime.of(2026, 1, 1, 12, 0, 0));
        sample.setItemName("示例物品");
        sample.setRarity(3);
        sample.setItemType("武器");
        sample.setPool("常驻");
        sample.setIsUp(Boolean.FALSE);
        sample.setPityCount(1);
        sample.setNote("示例行可删除，导入时会被忽略");
        sample.setCaptureTriggered(Boolean.FALSE);

        boolean json = "json".equalsIgnoreCase(format);
        byte[] content;
        MediaType mediaType;
        if (json) {
            java.util.Map<String, Object> sampleJson = new java.util.LinkedHashMap<>();
            sampleJson.put("wishTime", "2026-01-01 12:00:00");
            sampleJson.put("itemName", "示例物品");
            sampleJson.put("rarity", 3);
            sampleJson.put("itemType", "武器");
            sampleJson.put("pool", "常驻");
            sampleJson.put("isUp", Boolean.FALSE);
            sampleJson.put("pityCount", 1);
            sampleJson.put("note", "示例行可删除，导入时会被忽略");
            try {
                content = objectMapper.writerWithDefaultPrettyPrinter()
                        .writeValueAsBytes(java.util.Collections.singletonList(sampleJson));
            } catch (Exception e) {
                throw new BusinessException(500, "模板生成失败：" + e.getMessage());
            }
            mediaType = new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8);
        } else {
            content = WishCsv.write(java.util.Collections.singletonList(sample))
                    .getBytes(StandardCharsets.UTF_8);
            mediaType = new MediaType("text", "csv", StandardCharsets.UTF_8);
        }

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"southair-wishes-template." + (json ? "json" : "csv") + "\"")
                .contentType(mediaType)
                .body(content);
    }

    /**
     * 导入抽卡记录。
     *
     * @param format csv（默认）/ json
     * @param mode   merge（默认，跳过重复）/ replace（清空后全量导入）
     */
    @PostMapping("/import")
    public R<WishImportResult> importRecords(@RequestBody String body,
                                             @RequestParam(defaultValue = "genshin") String game,
                                             @RequestParam(defaultValue = "csv") String format,
                                             @RequestParam(defaultValue = "merge") String mode) {
        List<WishRecord> records = "json".equalsIgnoreCase(format)
                ? parseJson(body)
                : WishCsv.parse(body);
        return R.ok(wishService.importRecords(UserContext.require(), game, records, mode));
    }

    /**
     * 通过游戏内「抽卡记录」链接导入。后端代理抓取，浏览器直连会被跨域拦截。
     *
     * @param mode merge（默认，跳过重复）/ replace（清空后全量导入）
     */
    @PostMapping("/import-url")
    public R<WishImportResult> importFromUrl(@RequestBody GachaLinkRequest request,
                                             @RequestParam(defaultValue = "genshin") String game,
                                             @RequestParam(defaultValue = "merge") String mode) {
        return R.ok(gachaLinkImporter.importFrom(request.getUrl(), UserContext.require(), game, mode));
    }

    /**
     * 导出 UIGF v4.2（原神）/ SRGF v1.0（星穹铁道）。
     *
     * @param uid 指定 UID 时只导出该账号；为空导出全部 UID（SRGF 只能容纳一个 UID，取第一个）
     */
    @GetMapping("/export-uigf")
    public ResponseEntity<byte[]> exportUigf(@RequestParam(defaultValue = "genshin") String game,
                                             @RequestParam(required = false) String uid) {
        String gameKey = GameType.normalize(game);
        List<WishRecord> records = wishService.exportAll(UserContext.require(), gameKey, uid);
        String content = uigfService.export(records, gameKey, uid);
        String suffix = GameType.isStarRail(gameKey) ? "srgf" : "uigf";
        String filename = "southair-" + gameKey + "-" + suffix + "-"
                + LocalDateTime.now().format(FILE_TIME) + ".json";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8))
                .body(content.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 导入 UIGF v4.2 / SRGF v1.0 / UIGF v3。
     *
     * @param preview true 时只统计新增 / 重复 / 过滤数量，不写入
     */
    @PostMapping("/import-uigf")
    public R<WishImportResult> importUigf(@RequestBody String body,
                                          @RequestParam(defaultValue = "genshin") String game,
                                          @RequestParam(defaultValue = "merge") String mode,
                                          @RequestParam(defaultValue = "false") boolean preview) {
        UigfParseResult parsed = uigfService.parse(body, game);
        WishImportResult result = preview
                ? wishService.previewRecords(UserContext.require(), game, parsed.getRecords(), mode)
                : wishService.importRecords(UserContext.require(), game, parsed.getRecords(), mode);
        // 预览与导入都回填文件级计数，前端可展示「新增 / 重复 / 忽略 / 无效」
        result.setTotal(parsed.getTotal());
        result.setInvalid(parsed.getInvalid());
        result.setFiltered(parsed.getFiltered());
        return R.ok(result);
    }

    private LocalDateTime parseStart(String value) {
        String text = normalizeDateParam(value, false);
        return StringUtils.hasText(text) ? LocalDateTime.parse(text) : null;
    }

    private LocalDateTime parseEnd(String value) {
        String text = normalizeDateParam(value, true);
        return StringUtils.hasText(text) ? LocalDateTime.parse(text) : null;
    }

    /** 接受 yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss；纯日期按开始 / 结束当天处理。 */
    private String normalizeDateParam(String value, boolean endOfDay) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String text = value.trim().replace('T', ' ');
        if (text.length() == 10) {
            return text + (endOfDay ? " 23:59:59" : " 00:00:00");
        }
        if (text.length() == 16) {
            return text + ":00";
        }
        return text;
    }

    private List<WishRecord> parseJson(String body) {
        if (body == null || body.trim().isEmpty()) {
            throw new BusinessException("导入内容为空");
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode array = root != null && root.isArray() ? root : root == null ? null : root.get("wishes");
            if (array == null || !array.isArray()) {
                throw new BusinessException("JSON 文件中没有 wishes 记录数组");
            }
            List<WishRecord> records = new ArrayList<>();
            for (JsonNode node : array) {
                records.add(objectMapper.treeToValue(node, WishRecord.class));
            }
            return records;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("JSON 解析失败：" + e.getMessage());
        }
    }
}
