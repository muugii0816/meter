package mn.novelsoft.util;

import mn.novelsoft.domain.CommonValue;
import mn.novelsoft.service.CommonValueService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import javax.mail.*;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Properties;

@Configuration
@EnableScheduling
public class EmailService {

    @Autowired
    private CommonValueService commonValueService;

    private SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd hh:mm:ss");
    final String fromEmail = "emeter.erchimsuljee.mn@gmail.com"; // requires valid gmail id
//    final String password = "emeter.erchimsuljee.mn2022"; // correct password for gmail id
    final String password = "nemlogbxmpqcbiuf";

    public void sendEmail(String name, String number) {
        List<CommonValue> commonValues = commonValueService.findAllByParent("email");
        commonValues.stream().forEach(commonValue -> {
            try {
                String toEmail = commonValue.getDataString();

                Properties props = new Properties();
                props.put("mail.smtp.auth", "true");
                props.put("mail.smtp.starttls.enable", "true");
                props.put("mail.smtp.host", "smtp.gmail.com");
                props.put("mail.smtp.port", "587");

                Authenticator auth = new Authenticator() {
                    // override the getPasswordAuthentication method
                    @Override
                    protected PasswordAuthentication getPasswordAuthentication() {
                        return new PasswordAuthentication(fromEmail, password);
                    }
                };

                Session session1 = Session.getDefaultInstance(props, auth);
                MimeMessage msg = new MimeMessage(session1);
                msg.addHeader("Content-type", "text/HTML; charset=UTF-8");
                msg.addHeader("format", "flowed");
                msg.addHeader("Content-Transfer-Encoding", "8bit");

                msg.setFrom(new InternetAddress("NoReply@gmail.com", "Erchim suljee system"));

                msg.setSubject("Тоолуураас заалт авахад алдаа гарлаа", "UTF-8");

                msg.setContent("<html> <head> <meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\"/>"
                    + "<style> ul.a {  list-style-type: circle; } </style></head> " + "<body> " + " "
                    + "Сайн байна уу. <br> " + "Танд энэ өдрийн мэнд хүргэе! <br><br>"
                    + name + " нэр, " + number + " дугаартай тоолуурын заалт татахад алдаа гарлаа. Татал хийгдээгүй огноо: " + dateFormat.format(new Date()) + " <br><br>"
                    + "<br>" + "</body> "
                    + "</html>", "text/html;charset=UTF-8");
                msg.setSentDate(new Date());
                msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(toEmail, false));

                Transport.send(msg);
            } catch (MessagingException e) {
                e.printStackTrace();
            } catch (UnsupportedEncodingException e) {
                e.printStackTrace();
            }
        });
    }


    public void sendEmailModem(String name) {
        List<CommonValue> commonValues = commonValueService.findAllByParent("email");
        commonValues.stream().forEach(commonValue -> {
            try {
                String toEmail = commonValue.getDataString(); // can be any email id

                Properties props = new Properties();
                props.put("mail.smtp.auth", "true");
                props.put("mail.smtp.starttls.enable", "true");
                props.put("mail.smtp.host", "smtp.gmail.com");
                props.put("mail.smtp.port", "587");

                Authenticator auth = new Authenticator() {
                    // override the getPasswordAuthentication method
                    @Override
                    protected PasswordAuthentication getPasswordAuthentication() {
                        return new PasswordAuthentication(fromEmail, password);
                    }
                };

                Session session1 = Session.getDefaultInstance(props, auth);
                MimeMessage msg = new MimeMessage(session1);
                msg.addHeader("Content-type", "text/HTML; charset=UTF-8");
                msg.addHeader("format", "flowed");
                msg.addHeader("Content-Transfer-Encoding", "8bit");

                msg.setFrom(new InternetAddress("NoReply@gmail.com", "Erchim suljee system"));

                msg.setSubject("Mодемтой холбогдоход алдаа гарлаа!", "UTF-8");

                msg.setContent("<html> <head> <meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\"/>"
                    + "<style> ul.a {  list-style-type: circle; } </style></head> " + "<body> " + " "
                    + "Сайн байна уу. <br> " + "Танд энэ өдрийн мэнд хүргэе! <br><br>"
                    + name + " дугаартай модемтой холбогдоход алдаа гарлаа. Холболт хийгдээгүй огноо: " + dateFormat.format(new Date()) + " <br><br>"
                    + "<br>" + "</body> "
                    + "</html>", "text/html;charset=UTF-8");
                msg.setSentDate(new Date());
                msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(toEmail, false));

                Transport.send(msg);
            } catch (MessagingException e) {
                e.printStackTrace();
            } catch (UnsupportedEncodingException e) {
                e.printStackTrace();
            }
        });
    }
}
