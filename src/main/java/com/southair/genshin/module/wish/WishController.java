package com.southair.genshin.module.wish;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.PageResult;
import com.southair.genshin.common.R;
import com.southair.genshin.module.wish.dto.GachaLinkRequest;
import com.southair.genshin.module.wish.dto.WishBatchRequest;
import com.southair.genshin.module.wish.dto.WishImportResult;
import com.southair.genshin.module.wish.dto.WishRequest;
import com.southair.genshin.security.UserContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

    public WishController(WishService wishService, ObjectMapper objectMapper, GachaLinkImporter gachaLinkImporter) {
        this.wishService = wishService;
        this.objectMapper = objectMapper;
        this.gachaLinkImporter = gachaLinkImporter;
    }

    @GetMapping
    public R<PageResult<WishRecord>> list(@RequestParam(required = false) String pool,
                                          @RequestParam(defaultValue = "genshin") String game,
                                          @RequestParam(defaultValue = "1") int page,
                                          @RequestParam(defaultValue = "10") int size) {
        return R.ok(wishService.page(UserContext.require(), game, pool, page, size));
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
