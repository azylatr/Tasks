import smtplib
import ssl
from email.message import EmailMessage
from typing import Final
# import os, Recommended for securely storing credentials
from dotenv import get_key 

# Define email details
sender_email: str = "" # your_email@gmail.com
receiver_email: str = "" # receiver_email@example.com
# Use environment variables or prompt for passwords to keep them secure
# For this example, replace 'your_app_password' with your Gmail App Password
# Consider using environment variables in production: os.getenv("EMAIL_PASS")
# https://myaccount.google.com/apppasswords
password: str | None = get_key(".env", "EMAIL_PASS") # your_app_password

# Write a message and email subject to be sent to the destination email
message: list[str] = [
    "Email Subject",
    "This is the body of the email."
]

# Create the email message
msg: object = EmailMessage()
msg.set_content(message[1])
msg["Subject"] = message[0]
msg["From"] = sender_email
msg["To"] = receiver_email

# Gmail SMTP server configuration
smtp_server: str = "smtp.gmail.com"
smtp_port: Final[int] = 465 # For SSL connection (recommended)

try:
    # Create a secure SSL context and send the email
    context: object = ssl.create_default_context()
    with smtplib.SMTP_SSL(smtp_server, smtp_port, context=context) as server:
        server.login(sender_email, str(password))
        server.send_message(msg)
    print("Email sent successfully!")

except smtplib.SMTPException as Error:
    print(f"Error: Unable to send email. {Error}")
