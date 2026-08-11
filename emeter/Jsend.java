package mn.novelsoft.util;

import mn.novelsoft.enums.JsendStatusEnum;

import java.io.Serializable;
import java.util.HashMap;
import java.util.Map;

public class Jsend implements Serializable {

    private static final long serialVersionUID = 3297026891209263920L;
    private JsendStatusEnum status = null;
    private String message = null;
    private String code = null;
    private Map<String, Object> data = null;

    public Jsend() {
        super();
        status = JsendStatusEnum.success;
    }

    public Jsend(JsendStatusEnum status, String message) {
        super();
        this.status = status;
        this.message = message;
    }

    public void initiateData() {
        data = new HashMap<String, Object>();
    }

    public JsendStatusEnum getStatus() {
        return status;
    }

    public void setStatus(JsendStatusEnum status) {
        this.status = status;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public Map<String, Object> getData() {
        return data;
    }

    public void setData(Map<String, Object> data) {
        this.data = data;
    }

}

