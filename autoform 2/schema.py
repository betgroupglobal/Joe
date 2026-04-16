"""
autoform/schema.py
Recommended CSV schema and keyword-based field matching map.
"""

RECOMMENDED_COLUMNS = [
    "first_name", "last_name", "email", "password",
    "dob", "phone", "address", "city", "state", "zip_code", "country",
    "username",
    "pin",         # 4-digit security PIN "gender",
]

FIELD_MAP = {
    "first_name": ["first_name","firstname","first-name","fname","given","given_name","givenname"],
    "last_name":  ["last_name","lastname","last-name","lname","surname","family","family_name"],
    "email":      ["email","e-mail","mail","email_address","emailaddress"],
    "password":   ["password","passwd","pass","pwd","new_password","newpassword","create_password"],
    "dob":        ["dob","date_of_birth","dateofbirth","birth_date","birthdate","birthday","birth"],
    "phone":      ["phone","mobile","cell","telephone","tel","phone_number","phonenumber","contact"],
    "address":    ["address","addr","street","address1","address_line","street_address"],
    "city":       ["city","town","suburb","locality"],
    "state":      ["state","province","region"],
    "zip_code":   ["zip","postal","postcode","zip_code","zipcode","postal_code"],
    "country":    ["country","nation"],
    "username":   ["username","user_name","handle","login","screen_name","nickname"],
    "gender":     ["gender","sex"],
    "pin":        ["pin","security_pin","securitypin","4digit","4-digit","secure_pin","pin_code","pincode"],
}

INPUT_TYPE_MAP = {
    "email":    "email",
    "password": "password",
    "tel":      "phone",
    "date":     "dob",
}